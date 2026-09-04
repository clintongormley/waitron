import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Agent } from "undici";
import {
  asAppUser,
  captureError,
  createPostgresDb,
  readDeploymentEnvironment,
  readMembershipTrustSet,
  readNodeMembership,
  stampDeployment,
  withTenant,
} from "@waitron/db";
import { generateNodeKeyPair } from "@waitron/membership";
import {
  cloneTemplate,
  nextCloneName,
  pickTemplate,
  resolveSharedHandle,
  useTemplateDb,
} from "@waitron/db/testing/lifecycle.js";
import { isAppError } from "@waitron/shared";
import { loadKeyRing, putCredential } from "@waitron/credentials";
// The exact test-only entry point `packages/fiscal-verifactu`'s OWN tests use to seed a due
// `envios` row — mirroring the established cross-package convention (e.g.
// `@waitron/payments/test/seed.js` from `packages/payments-stripe`'s suites): no `exports` map
// restricts either package, so the deep import resolves the same way a same-package one would.
import { seedPendingEnvios } from "@waitron/fiscal-verifactu/test/drain-fixtures.js";
import {
  appliedSchemaVersion,
  expectedSchemaVersion,
  manifestSets,
  migrationOptionsFor,
} from "@waitron/migrations";
import { orderedMigrationSets } from "@waitron/module";
import { enrolPeer, runRetentionSweep, runSyncPull } from "@waitron/sync";
import { runTunnelClient } from "@waitron/tunnel";
import {
  DEFAULT_MIGRATIONS_ROOT,
  MAX_UPLOAD_BYTES,
  startServer,
  type StartedServer,
} from "./boot.js";
import { ALL_MODULES } from "./modules.js";
import { DUTY_BUDGET_MS } from "./health.js";
import { DRAIN_DUTY } from "./pass.js";
import { roleUrl } from "./testing/postgres.js";
import { mintMtlsMaterial } from "./testing/tls.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { loadTillConfig } from "./till-config.js";
import type { TillConfig } from "./till-config.js";
import { enrolDevice, generatePairingCode } from "./device.js";
import { DEV_DEVICE_HEADER } from "./device-session.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";

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
 *
 * `runRetentionSweep` is wrapped the same way, for the same reason: boot starts it directly (no
 * injection seam), so the retention tests below observe the CALL (was it started, with what tickMs and
 * shared signal) via this spy. It calls THROUGH to the real sweep, whose abort-aware loop settles when
 * close() aborts `syncController`, so close()'s teardown is exercised for real.
 */
vi.mock("@waitron/sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/sync")>();
  return {
    ...actual,
    runSyncPull: vi.fn(actual.runSyncPull),
    runRetentionSweep: vi.fn(actual.runRetentionSweep),
  };
});

/**
 * `boot.ts` starts the outbound cloud-mirror tunnel client via `runTunnelClient`, imported directly
 * (no injection seam), exactly like the sync workers above. The tunnel tests below observe the CALL
 * (was it started, with which relay host/port/boxId/token, with `localPort === config.httpPort`, and
 * under the boot AbortSignal close() aborts) via this spy, which calls THROUGH to the real client so
 * close()'s teardown is exercised for real — the client resolves on abort, tearing every live socket
 * down. Every OTHER test in this file sets no `WAITRON_TUNNEL_*`, so `loadTunnelConfig` returns
 * undefined and the spy is never called there.
 */
vi.mock("@waitron/tunnel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/tunnel")>();
  return {
    ...actual,
    runTunnelClient: vi.fn(actual.runTunnelClient),
  };
});

// The two sync-worker spies accumulate calls across tests (one shared module mock), so clear them
// before each so the call-count/args assertions below are order-independent — this file's own rule
// (several tests were fixed for order-dependence). `mockClear` resets only `mock.calls`, keeping each
// spy's `vi.fn(actual.*)` call-through implementation.
beforeEach(() => {
  vi.mocked(runSyncPull).mockClear();
  vi.mocked(runRetentionSweep).mockClear();
  vi.mocked(runTunnelClient).mockClear();
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
// The till's fiscal identity. `loadConfig` resolves `config.till` OPTIONALLY via `tryLoadTillConfig`
// (undefined when none of the five ids are set — setup mode, slice 1b); it is boot's TRADING branch
// that REQUIRES a venue, so every provisioned-boot test in this suite must carry these. Distinct per
// field, matching till-config.test.ts's convention. Folded into `KEY_ENV` below so every trading boot
// in this suite carries one; the two config-guard tests at the bottom, which omit `KEY_ENV` on purpose
// to reach `server.config_invalid` / `credentials.key_missing`, spread it directly to stay in trading
// mode (a bare `config.till === undefined` would branch to setup mode and never reach either).
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
  // The passkey Relying Party ID + origin, now REQUIRED by `loadConfig` in production — every
  // real-host boot in this suite that sets `WAITRON_ENV: "production"` would otherwise throw
  // `server.config_missing` before reaching the behaviour it tests. Folded into `KEY_ENV` for the
  // same reason as the credentials key and till identity above: it is boot config every production
  // host must carry. The two bottom config-guard tests spread `TILL_ENV` (preproduction), where these
  // stay optional, so they are unaffected.
  WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
  WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
  ...TILL_ENV,
};

// A clone of the full-manifest template. `PROBE_ROLE` (server_boot_probe) and `RUNTIME_ROLE`
// (server_boot_runtime_probe) are created cluster-wide by the package globalSetup, in place of the
// per-file `probeRole` + `beforeAll` role creation this suite used before the shared container; the
// per-DATABASE grants `PROBE_ROLE` needs to re-run migrations are applied to this clone in the
// `beforeAll` below (they cannot be cluster-wide — they name this database).
const suite = useTemplateDb({ template: "manifest" });

let migrationsRoot: string;
let databaseUrl: string;
let runtimeDatabaseUrl: string;
// The sync-api pool's URL — a `sync_applier` (app_user + sync_tailer member) URL, the exact
// "sync_tailer + app_user member" shape boot.ts documents for the sync pool. It is NOT the deployment
// role (PROBE_ROLE = app_user only): since Task 5 the source authenticates every request against
// `sync_peers`, so its pool needs sync_tailer's SELECT + UPDATE(last_seen_at) on that table, which
// app_user does not hold. `syncPeerToken` is a peer enrolled below (as the superuser admin), the token
// the /sync-api/hello probes present.
let syncDatabaseUrl: string;
let syncPeerToken: string;

beforeAll(async () => {
  const dbName = new URL(suite.pg.uri).pathname.replace(/^\//, "");
  // `CREATE` on the database and on `public`: Drizzle's migrator issues `CREATE SCHEMA IF NOT
  // EXISTS "public"` (database-level `CREATE`) then `CREATE TABLE IF NOT EXISTS` per migration set
  // (schema-level `CREATE`) before it ever checks whether either already exists.
  await suite.admin.execute(sql.raw(`grant create on database ${dbName} to ${PROBE_ROLE}`));
  await suite.admin.execute(sql.raw(`grant create on schema public to ${PROBE_ROLE}`));
  // `SELECT` on every table in `public`, not just the five journal tables by name: the `manifest`
  // template was migrated as the container's superuser (in the package globalSetup), so the
  // deployment role does not OWN the journal tables it must read back from to decide nothing new
  // needs applying.
  await suite.admin.execute(
    sql.raw(`grant select on all tables in schema public to ${PROBE_ROLE}`),
  );

  databaseUrl = roleUrl(suite.pg.uri, PROBE_ROLE, PROBE_PASSWORD);

  // `RUNTIME_ROLE` — `app_user` membership and nothing else, the role spec §10 actually means by
  // "the non-superuser deployment role" — is created cluster-wide by the package globalSetup (with no
  // `CREATE`/`SELECT` beyond `app_user`'s). It can do the duty work (drain/reconcile read and write
  // through `app_user`'s own table grants, applied by the migrations themselves) but cannot run a
  // migration against an already-migrated database, for the identical permission-denied-before-`IF NOT
  // EXISTS` reason `PROBE_ROLE`'s own comment above explains. Only its clone-scoped connection URL is
  // built here; no per-DATABASE grant is added, which is exactly what makes it least-privileged.
  runtimeDatabaseUrl = roleUrl(suite.pg.uri, RUNTIME_ROLE, RUNTIME_PASSWORD);

  // The sync pool's role + a peer enrolled on this clone. `sync_applier` (app_user + sync_tailer) is
  // created cluster-wide by the package globalSetup; enrolPeer runs as the superuser admin (setup
  // bypasses grants). The sync tests below present `syncPeerToken` to /sync-api/hello, which the source
  // now resolves against sync_peers through this pool (Task 5 — the auth path touches the DB).
  syncDatabaseUrl = roleUrl(suite.pg.uri, "sync_applier", "ap");
  syncPeerToken = (await enrolPeer(suite.admin, { subscriberId: "boot-mirror", name: "boot" }))
    .token;

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

// The temporary migrations root is this suite's own; the clone and `suite.admin` are
// `useTemplateDb`'s. Guarded the same way: a `beforeAll` that threw before `mkdtemp` returned
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
 * A `fetch` init that trusts `ca` for an HTTPS dial against a self-signed leaf — the same
 * `undici` `Agent` + cast the two HTTPS boot tests below each need, differing only in which CA
 * they trust (the box-minted one vs. an operator-supplied one). `close()` wraps the dispatcher's
 * own `close()` so callers still tear it down explicitly in their `finally`, alongside the server.
 */
function httpsVia(ca: string | Buffer): {
  via: RequestInit & { dispatcher: Agent };
  close: () => Promise<void>;
} {
  const dispatcher = new Agent({ connect: { ca } });
  return {
    via: { dispatcher } as RequestInit & { dispatcher: Agent },
    close: () => dispatcher.close(),
  };
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

/**
 * `boot.ts`'s setup branch defaults `requestRestart` to `process.kill(process.pid, "SIGTERM")` — the
 * identical hardcoded-side-effect design `withMockedExit` above already works around for
 * `process.exit`, applied to the one restart side effect this file needs to observe WITHOUT actually
 * signalling the vitest worker (no `bin.ts` SIGTERM handler is installed under vitest, so a real
 * SIGTERM would terminate it). Every call is recorded — pid + signal — so the provision test can
 * assert the restart fired exactly once, with what, after the 200.
 */
async function withMockedKill<T>(
  fn: (kills: { pid: number; signal: string | number | undefined }[]) => Promise<T>,
): Promise<T> {
  const original = process.kill;
  const kills: { pid: number; signal: string | number | undefined }[] = [];
  process.kill = ((pid: number, signal?: string | number) => {
    kills.push({ pid, signal });
    return true;
  }) as typeof process.kill;
  try {
    return await fn(kills);
  } finally {
    process.kill = original;
  }
}

/** A valid ES-common venue body for `POST /setup-api/provision`, with PLAINTEXT admin secrets (the
 * endpoint hashes them at its boundary). Mirrors `provision.test.ts`'s fixture shape; shared by the
 * two provision full-boot tests below, which differ only in the `taxId` and whether an `aeatCert`
 * rides alongside it. */
function provisionVenueBody(taxId: string) {
  return {
    country: "ES",
    taxId,
    legalName: "Deli Test SL",
    location: {
      name: "Sala principal",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
    },
    tillName: "Caja 1",
    seriesCode: "A",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Administradora",
      pin: "1234",
      password: "dashPass123",
      email: "admin@waitron.dev",
    },
  };
}

/** Parse a `KEY=value\n` env file's lines (split on the FIRST `=`, so a value's own `=` — a base64
 * pad or a URI query — survives), for reading `trading.env` back. Mirrors `writeTradingEnv`'s writer
 * and the shared `env-file.ts` `parseEnvFile`. */
function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
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
    // A throwaway log dir so this real boot's assembled rotating file sink writes somewhere isolated —
    // the assertion below reads `<logDir>/waitron.log` back to prove the sink is wired into `startServer`
    // (not just constructable in a unit test), end to end through the tee'd `log`.
    const logDir = await mkdtemp(join(tmpdir(), "waitron-boot-logs-"));
    const [server, sleeping, listening] = await withCapturedStdout(async (lines) => {
      const started = await startServer({
        ...KEY_ENV,
        DATABASE_URL: databaseUrl,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_LOG_DIR: logDir,
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
      // The request-id middleware is live and wraps every route mounted after it (registered on the
      // shared app before all the API mounts): this mounted route echoes a generated `x-request-id`
      // matching the safe charset. Proof `requestIdMiddleware` is mounted, not merely importable.
      expect(staff.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(await staff.json()).toEqual([]);

      // The catalogue write group is mounted on the same app (`mountCatalogueApi` in `boot.ts`). It is
      // fully gated, so an UNAUTHENTICATED `GET /management-api/catalogues` answers 401
      // (`management_session.required`) rather than 404 — a 404 here would mean the mount never ran.
      const catalogues = await fetch(`http://127.0.0.1:${port}/management-api/catalogues`);
      expect(catalogues.status).toBe(401);
      expect((await catalogues.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "management_session.required" },
      });

      // The recovery-bundle download (slice 4b-i) is mounted on the same app (`mountRecoveryBundleApi`
      // in `boot.ts`), gated by the SAME management session as box-status. An UNAUTHENTICATED
      // `POST /api/box/recovery-bundle` answers 401 (`management_session.required`) rather than 404 — a
      // 404 here would mean the mount never ran, a 200 that a secret download is ungated.
      const recovery = await fetch(`http://127.0.0.1:${port}/api/box/recovery-bundle`, {
        method: "POST",
      });
      expect(recovery.status).toBe(401);
      expect((await recovery.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "management_session.required" },
      });

      // The rotating FILE sink is wired into the assembled logger: `server.listening` is an `info`
      // event, above the default verbosity, so the tee'd sink appended it to `<logDir>/waitron.log`.
      // Reading it back proves the file half of the `tee(stdout, fileSink)` is live in a real boot —
      // the stdout half is what `withCapturedStdout` already observes above.
      expect(existsSync(join(logDir, "waitron.log"))).toBe(true);
      const logText = await readFile(join(logDir, "waitron.log"), "utf8");
      expect(logText).toContain('"event":"server.listening"');

      // TRADING MODE ran the shared migration seam (boot.ts's one `applyMigrations`, before the
      // mode branch): every module's `__drizzle_migrations_<name>` journal is populated to the
      // version its shipped folder declares. This is the SAME seam SP-1a inverted to derive its set
      // list from `ALL_MODULES` — asserted here over `orderedMigrationSets(ALL_MODULES)` (the new
      // source) so a conversion that dropped or reordered a set surfaces as a mismatch. It is a
      // consistency check, not the from-empty probe: this clone was pre-migrated by the shared
      // container, so the distinguishing "boot is the sole migrator" proof lives in the setup-mode
      // fresh-database test below; both modes reach the identical seam line, so proving it once from
      // empty and confirming trading mode leaves the same nine journals consistent covers both.
      for (const set of orderedMigrationSets(ALL_MODULES)) {
        const expected = expectedSchemaVersion(set, migrationsRoot);
        expect(expected).toBeGreaterThan(0);
        expect(await appliedSchemaVersion(suite.admin, set)).toBe(expected);
      }
    } finally {
      await server.close();
      await rm(logDir, { recursive: true, force: true });
    }

    // A second, concurrent-in-effect close() (the previous one already resolved, but the guard
    // covers this "already closed" case identically to a genuinely racing pair) must not throw
    // pg-pool's "Called end on pool more than once" — the idempotency guard this task added.
    await expect(server.close()).resolves.toBeUndefined();

    // The listener actually closed: a request against the same port now fails to connect rather
    // than hanging or succeeding against a server that never really stopped.
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  }, 60_000);

  it("boots in setup mode over HTTPS from a minted self-signed cert, serves /setup-api/status, refuses plain HTTP, and does not mount the trading routes", async () => {
    // SETUP MODE (slice 1b): `config.till === undefined`, reached by omitting all five
    // WAITRON_TILL_*_ID AND the credentials key. The DB is still migrated (the shared prefix runs
    // applyMigrations in both modes, ready for slice 2's wizard), but boot mounts ONLY /health + the
    // unauthenticated setup surface — no key ring, no reconciler/duty, no readOrderFlow, no trading
    // routes, no sync transport, no drain/reconcile workers. DATABASE_URL is PROBE_ROLE so the shared
    // applyMigrations still runs idempotently against the template.
    //
    // NEW in slice 2a: the box serves this surface over HTTPS from a self-signed cert it MINTS + then
    // reuses on later boots (`ensureBoxSecrets`), and generates its box secrets (key ring + node
    // token) alongside. A fresh `WAITRON_STATE_DIR` (mkdtemp, cleaned up below) gives it somewhere to
    // write; we read the minted CA back to trust the leaf, dial every route over HTTPS, then confirm a
    // plain-HTTP dial to the same port now FAILS — proof this is HTTPS, not the plain HTTP slice 1b
    // served. `WAITRON_STATE_DIR` is REQUIRED here, not optional: without it `ensureBoxSecrets` would
    // write into `boot.ts`'s from-source default (`apps/server/src/state`) and pollute the checkout.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-setup-state-"));
    const server = await startServer({
      DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_STATE_DIR: stateDir,
      WAITRON_ENV: "preproduction",
    });
    // Trust the CA the box just minted, so the self-signed leaf verifies. `undici`'s `Agent` is real
    // (this file mocks only `undici`'s `fetch`, not `Agent` — see the header comment), and Node's
    // GLOBAL `fetch` (a separate module identity from the mocked `"undici"` specifier) honours a
    // `dispatcher` on its init. The leaf carries `127.0.0.1` as an iPAddress SAN (ensureBoxSecrets adds
    // it unconditionally), so a loopback dial verifies.
    const ca = await readFile(join(stateDir, "tls", "ca.crt"));
    const { via, close } = httpsVia(ca);
    try {
      // The setup status fact sheet (Task 2's `mountSetup`), over HTTPS — proof `config.environment`
      // threaded through the setup branch into `mountSetup`, and that the minted cert actually serves.
      const status = await fetch(`https://127.0.0.1:${port}/setup-api/status`, via);
      expect(status.status).toBe(200);
      expect(await status.json()).toEqual({
        provisioned: false,
        environment: "preproduction",
        needs: ["venue"],
      });

      // The placeholder shell answers any unclaimed path (200 HTML) over HTTPS too.
      const root = await fetch(`https://127.0.0.1:${port}/`, via);
      expect(root.status).toBe(200);
      expect(root.headers.get("content-type")).toContain("text/html");
      expect(await root.text()).toMatch(/set ?up/i);

      // /health still answers — `createHealthState` + `healthApp` are in the shared prefix. It reports
      // 503 (never-passed: a setup box runs no duty loop, so `lastPassAt` stays null), not a
      // route-missing failure; the assertion is only that it ANSWERS (status < 600).
      const health = await fetch(`https://127.0.0.1:${port}/health`, via);
      expect(health.status).toBeLessThan(600);

      // The trading routes are NOT mounted: /api/staff is answered by the setup catch-all (the HTML
      // placeholder), NOT the trading roster route — which would return the JSON `[]` the trading-mode
      // test below asserts. A 200 text/html placeholder here proves the trading route never registered.
      const staff = await fetch(`https://127.0.0.1:${port}/api/staff`, via);
      expect(staff.status).toBe(200);
      expect(staff.headers.get("content-type")).toContain("text/html");
      expect(await staff.text()).toMatch(/set ?up/i);

      // The box minted + persisted its secrets alongside the cert (`ensureBoxSecrets` writes
      // secrets.env with the credentials key ring, 0600), ready for slice 2b to load.
      expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toMatch(
        /WAITRON_CREDENTIALS_KEY=/,
      );

      // A plain-HTTP dial to the same port now FAILS: the listener speaks TLS, so an http:// request
      // never completes a valid handshake (it is HTTPS now, not the plain HTTP slice 1b served). No
      // dispatcher — a bare global fetch against the TLS port is torn down mid-request.
      await expect(fetch(`http://127.0.0.1:${port}/setup-api/status`)).rejects.toThrow();
    } finally {
      await server.close();
      await close();
      await rm(stateDir, { recursive: true, force: true });
    }
    // close() is correct and idempotent for the setup branch (no workers/sync to abort): a second
    // close() resolves without throwing, and the listener is genuinely gone. This probe TRUSTS the
    // box's CA (a fresh dispatcher — the one built above was already closed in the `finally`), so a
    // still-listening server would SUCCEED here (e.g. a 503 from /health) rather than rejecting on a
    // TLS-verification failure regardless of whether the listener stopped. `rejects.toThrow()`
    // therefore passes ONLY when the connection is genuinely refused, i.e. the listener is truly gone
    // — a bare (CA-blind) fetch against a self-signed HTTPS endpoint would reject either way and prove
    // nothing about close().
    await expect(server.close()).resolves.toBeUndefined();
    const afterClose = httpsVia(ca);
    try {
      await expect(fetch(`https://127.0.0.1:${port}/health`, afterClose.via)).rejects.toThrow();
    } finally {
      await afterClose.close();
    }
  }, 60_000);

  it("setup mode migrates all nine module sets from an EMPTY database — boot is the sole migrator (SP-1a)", async () => {
    // The from-empty probe SP-1a's inversion needs (spec §6, §4 pin 2): boot, and only boot, must
    // migrate every module set the composition list carries. The other boot tests clone the
    // pre-migrated `manifest` template, so their journals are populated whether or not boot's seam
    // ran — a measurement where both answers look alike (CLAUDE.md §1). This test boots against a
    // PRISTINE database (`template0`, no app objects), so each `__drizzle_migrations_<name>` table
    // exists and is populated ONLY because boot's `applyMigrations` created it.
    //
    // Setup mode (all five WAITRON_TILL_*_ID omitted) reaches the SAME single seam trading mode does
    // — `boot.ts`'s one `applyMigrations` runs in the shared prefix, before the mode branch — and it
    // needs no seeded venue (no `readOrderFlow`), so it is the mode that can boot a fresh database.
    // The deployment probe that runs BEFORE migrations reads `null` on an unstamped/unmigrated DB
    // (`assertDeploymentMatches`) and passes. Every migration that creates a cluster-global role
    // guards it with `IF NOT EXISTS`, so a full-manifest migrate in this already-populated cluster is
    // idempotent — the shared container migrates its own `manifest` template the same way.
    //
    // Regression visibility: were the converted seam to derive fewer sets (a broken import, an empty
    // list), the missing set's journal would be absent and `appliedSchemaVersion` would read 0
    // against a non-zero `expectedSchemaVersion` — this test goes RED. Run against the pre-change
    // boot (seam still on `manifestSets()`) it is GREEN, because the pin makes the two lists equal.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-empty-state-"));
    // A pristine database in the shared cluster. `template0` carries no app objects, so nothing but
    // boot's migration run can populate the journals below; the superuser URL doubles as the app
    // pool's and the migrator's (this test proves migrations run, not RLS as the deployment role).
    // `cloneTemplate` validates the identifiers it interpolates into the CREATE/DROP DATABASE
    // utility statements (CLAUDE.md §3) and its `stop()` drops the clone WITH (FORCE) on a fresh
    // admin connection.
    const pg = await cloneTemplate(suite.pg.uri, "template0", nextCloneName());
    let server: StartedServer | undefined;
    let probe: Awaited<ReturnType<typeof createPostgresDb>> | undefined;
    try {
      server = await startServer({
        DATABASE_URL: pg.uri,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_STATE_DIR: stateDir,
        WAITRON_ENV: "preproduction",
      });

      probe = await pg.connect();
      // Every one of the nine module sets `ALL_MODULES` derives — the new source boot.ts reads — is
      // migrated to its shipped-folder head. `expected > 0` is the control: a set with an empty
      // journal would make `0 === 0` pass without boot having migrated anything (CLAUDE.md §1).
      const sets = orderedMigrationSets(ALL_MODULES);
      expect(sets).toHaveLength(9);
      for (const set of sets) {
        const expected = expectedSchemaVersion(set, migrationsRoot);
        expect(expected).toBeGreaterThan(0);
        expect(await appliedSchemaVersion(probe, set)).toBe(expected);
      }
    } finally {
      if (probe !== undefined) await probe.close();
      if (server !== undefined) await server.close();
      await rm(stateDir, { recursive: true, force: true });
      // Drop the throwaway clone; `cloneTemplate`'s `stop()` runs `drop database … with (force)` on a
      // fresh admin connection, closing any lingering backend (the app pool and probe are closed
      // above, but the boot's own migrator connection is opened and closed inside `applyMigrations`,
      // so this is belt-and-braces).
      await pg.stop();
    }
  }, 60_000);

  it("trading mode migrates ONLY the modules.json-enabled sets, skipping a disabled toggleable module (SP-1b)", async () => {
    // SP-1b's trading-mode filter (spec §1.3): on a trading boot the migration seam migrates only the
    // sets the on-box `<stateDir>/modules.json` enables, not every module. A pristine `template0` clone
    // is the ONLY harness that can PROVE a skip — the pre-migrated `manifest` template already carries
    // every `__drizzle_migrations_<name>` journal, so a filtered run there could never make one ABSENT
    // (a measurement where both answers look alike measures nothing, CLAUDE.md §1). Here `scheduler` is
    // disabled, so its journal exists after boot ONLY if the filter failed to skip it — which is exactly
    // the prove-by-deletion target (revert `setsToMigrate` to an unconditional `ALL_MODULES` and this
    // goes RED, the scheduler table reappears).
    //
    // A disabled statically-wired module can break a FULL trading boot (SP-1b does not claim a module
    // can be turned off and still boot-and-trade), and this pristine clone carries no seeded venue for
    // `readOrderFlow` either — both throw AFTER the shared migration seam and the drift log have already
    // run. So the boot is wrapped in try/catch and the assertion is on the RESULTING migration-table
    // state, not on boot success (assert what actually happened, CLAUDE.md §1).
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-modules-filter-state-"));
    // Disable one toggleable module. `core` is never disableable (`parseModuleConfig` refuses it);
    // `scheduler` is `tier: "toggleable"` in ALL_MODULES and owns `__drizzle_migrations_scheduler`, so
    // its absence/presence is an unambiguous witness of whether the filter ran.
    await writeFile(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { scheduler: false } }),
    );
    // Pristine clone: `template0` carries no app objects, so a journal below exists only because boot's
    // (now filtered) migration run created it. Superuser URL doubles as migrator + pool, as the
    // setup-from-empty test above; the deployment probe reads `null` on the unstamped DB and passes.
    const pg = await cloneTemplate(suite.pg.uri, "template0", nextCloneName());
    let server: StartedServer | undefined;
    let probe: Awaited<ReturnType<typeof createPostgresDb>> | undefined;
    try {
      try {
        server = await startServer({
          ...KEY_ENV,
          DATABASE_URL: pg.uri,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_ENV: "preproduction",
        });
      } catch {
        // Expected: this pristine clone seeds no venue, so the trading branch's `readOrderFlow` (and a
        // disabled statically-wired module's own wiring) throws AFTER the migration seam this test
        // asserts. The throw is swallowed deliberately — the seam's effect is already committed.
      }
      probe = await pg.connect();
      // The disabled module's journal is ABSENT — the filter skipped its set entirely (only its own
      // migration run would create the table). `to_regclass` returns NULL for a missing relation,
      // matching the style already used in the tree.
      const schedulerReg = await probe.execute<{ reg: string | null }>(
        sql.raw(`select to_regclass('public.__drizzle_migrations_scheduler') as reg`),
      );
      expect(schedulerReg.rows[0]!.reg).toBeNull();
      // A DIFFERENT toggleable module's journal IS present and populated to its shipped head — the
      // filter kept every ENABLED set. `payments` is enabled (absent from the override map = default-on)
      // and owns its own journal; `expected > 0` is the control (an empty journal would let `0 === 0`
      // pass without the set having been migrated at all, CLAUDE.md §1).
      const payments = ALL_MODULES.find((m) => m.name === "payments")!;
      const paymentsExpected = expectedSchemaVersion(payments.migrations, migrationsRoot);
      expect(paymentsExpected).toBeGreaterThan(0);
      expect(await appliedSchemaVersion(probe, payments.migrations)).toBe(paymentsExpected);
      // `core` (mandatory, never disableable — its table is `__drizzle_migrations_db`) migrated too:
      // `enabledModules` never drops it whatever modules.json says.
      const core = ALL_MODULES.find((m) => m.name === "core")!;
      const coreExpected = expectedSchemaVersion(core.migrations, migrationsRoot);
      expect(coreExpected).toBeGreaterThan(0);
      expect(await appliedSchemaVersion(probe, core.migrations)).toBe(coreExpected);
    } finally {
      if (probe !== undefined) await probe.close();
      if (server !== undefined) await server.close();
      await rm(stateDir, { recursive: true, force: true });
      await pg.stop();
    }
  }, 60_000);

  it("trading mode logs module.reconcile drift naming a soft-disabled module (SP-1b spec §3)", async () => {
    // The drift-log half of SP-1b (spec §3): a module the DATABASE has migrated but modules.json no
    // longer enables is `softDisabled` — its data is kept, it is simply not migrated — and boot logs
    // the reconcile outcome at `info` so an operator sees it. The shared suite DB (`databaseUrl`) is
    // already migrated for every module AND carries the seeded venue, so a trading boot with
    // `scheduler` disabled BOOTS SUCCESSFULLY (no throw): the filtered migration is a no-op for the 8
    // enabled sets (already applied, idempotent) and never touches scheduler's still-present table
    // (migrations never drop — its data is kept), so the drift read finds scheduler `migrated ∧
    // ¬enabled` = softDisabled and logs it. Captured on stdout below.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-drift-state-"));
    await writeFile(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { scheduler: false } }),
    );
    let server: StartedServer | undefined;
    try {
      const [started, reconcileLine] = await withCapturedStdout(async (lines) => {
        const s = await startServer({
          ...KEY_ENV,
          DATABASE_URL: databaseUrl,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_ENV: "production",
          WAITRON_MIN_TICK_MS: "50",
          WAITRON_MAX_TICK_MS: "200",
          WAITRON_SKIP_RETRY_MS: "100",
        });
        // The reconcile line is logged synchronously in the shared prefix, BEFORE the mode branch and
        // the listener — so by the time `startServer` resolves it is already captured. Parse it out of
        // the JSON stdout lines.
        let found: LogLine | undefined;
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as LogLine;
            if (parsed.event === "module.reconcile") found = parsed;
          } catch {
            continue;
          }
        }
        if (found === undefined) {
          throw new Error(`expected a "module.reconcile" line, saw:\n${lines.join("\n")}`);
        }
        return [s, found] as const;
      });
      server = started;
      // Names the soft-disabled module — the operator-visible signal that scheduler's schema is in the
      // DB but no longer enabled. `toMigrate` is empty: every ENABLED set was already migrated in the
      // shared DB, so nothing is pending.
      expect(reconcileLine.softDisabled).toEqual(["scheduler"]);
      expect(reconcileLine.toMigrate).toEqual([]);
    } finally {
      if (server !== undefined) await server.close();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("setup mode serves the built setup wizard at / end-to-end when WAITRON_SETUP_APP_DIR is configured", async () => {
    // The end-to-end proof that `config.setupAppDir` threads config → boot's SETUP branch → `mountSetup`
    // → `mountSpa`: a real `startServer` boot in setup mode (all five WAITRON_TILL_*_ID omitted) with
    // WAITRON_SETUP_APP_DIR pointed at a marked throwaway dir. `GET /` must return that marker (the built
    // wizard), NOT the inline placeholder shell — the setup-mode analogue of the till/dashboard
    // end-to-end SPA test below. This is the missing wire-up proof: the other setup tests are a
    // `mountSetup`-direct unit test (bypasses config/boot) plus a full-boot test for only the
    // missing-index FAILURE path. Deletion-proof: mutate boot.ts's `setupAppDir: config.setupAppDir` to
    // `undefined` (or to `config.tillAppDir`, unset here) and this goes RED — `GET /` falls back to the
    // placeholder. Same HTTPS setup-mode harness the status test above uses (the box mints + serves its
    // own self-signed cert), so `/` is dialled over https trusting the box CA.
    const wizardApp = mkdtempSync(join(tmpdir(), "waitron-boot-setup-spa-"));
    writeFileSync(join(wizardApp, "index.html"), "<html>setup-wizard-served-e2e</html>");
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-setup-spa-state-"));
    const server = await startServer({
      DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_STATE_DIR: stateDir,
      WAITRON_ENV: "preproduction",
      WAITRON_SETUP_APP_DIR: wizardApp,
    });
    const ca = await readFile(join(stateDir, "tls", "ca.crt"));
    const { via, close } = httpsVia(ca);
    try {
      // GET / serves the built wizard bundle, not the placeholder — the whole config→boot→mountSpa wire.
      const root = await fetch(`https://127.0.0.1:${port}/`, via);
      expect(root.status).toBe(200);
      expect(root.headers.get("content-type")).toContain("text/html");
      const text = await root.text();
      expect(text).toContain("setup-wizard-served-e2e"); // the built wizard
      expect(text).not.toContain("needs setup"); // NOT the inline placeholder shell

      // The setup API still answers as JSON: the wizard's `mountSpa` catch-all (registered LAST) did not
      // shadow /setup-api/status.
      const status = await fetch(`https://127.0.0.1:${port}/setup-api/status`, via);
      expect(status.status).toBe(200);
      expect(await status.json()).toEqual({
        provisioned: false,
        environment: "preproduction",
        needs: ["venue"],
      });
    } finally {
      await server.close();
      await close();
      await rm(stateDir, { recursive: true, force: true });
      rmSync(wizardApp, { recursive: true, force: true }); // guarded teardown (CLAUDE.md §4)
    }
  }, 60_000);

  it("fails the boot LOUDLY when WAITRON_SETUP_APP_DIR is set but holds no index.html, naming the var", async () => {
    // Slice 2c: the setup-wizard app dir joins the till/dashboard app dirs in the `assertBuiltApp`
    // fail-fast group, which runs in the SHARED prefix BEFORE any pool is opened. A configured-but-
    // never-built wizard dir must therefore throw `server.config_invalid` naming WAITRON_SETUP_APP_DIR
    // before boot ever touches the database — the same LOUD posture the other two app dirs get
    // (spa-api.test.ts unit-tests `assertBuiltApp` itself; THIS proves boot wires it for the setup
    // dir). No container needed: the throw precedes `createPostgresDb`, so the dummy DATABASE_URL below
    // is never dialled and no pool leaks. Deletion-proof: remove the `assertBuiltApp(config.setupAppDir,
    // …)` line in boot.ts and this goes RED (the mis-built dir reaches `mountSpa`, 404ing every page
    // load instead of failing the boot).
    const emptyDir = mkdtempSync(join(tmpdir(), "waitron-boot-setup-noindex-"));
    try {
      let caught: unknown;
      try {
        await startServer({
          DATABASE_URL: "postgres://unused:unused@localhost/unused",
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_MIN_TICK_MS: "50",
          WAITRON_MAX_TICK_MS: "200",
          WAITRON_SKIP_RETRY_MS: "100",
          WAITRON_SETUP_APP_DIR: emptyDir,
        });
      } catch (error) {
        caught = error;
      }
      expect(isAppError(caught)).toBe(true);
      expect(isAppError(caught) && caught.code).toBe("server.config_invalid");
      // Names the env var the operator must fix and a reason CODE, never the path itself — the no-leak,
      // name-the-variable discipline every other `server.config_invalid` follows.
      expect(isAppError(caught) && caught.params).toEqual({
        variable: "WAITRON_SETUP_APP_DIR",
        reason: "missing_index_html",
      });
    } finally {
      rmSync(emptyDir, { recursive: true, force: true }); // guarded teardown (CLAUDE.md §4)
    }
  });

  it("setup mode serves the discovery JSON, the CA download, and the trust page over HTTPS (slice 3)", async () => {
    // Slice 3's discovery surface is mounted in the SETUP branch only (a trading box's tills are
    // already paired). It rides the same minted self-signed cert the shared setup path produces
    // (`ensureBoxSecrets`), so every route is dialled over HTTPS trusting the box CA — read back the
    // same way the setup-mode HTTPS test above does. This is the prove-by-deletion target for
    // "setup-only": moving `mountDiscovery` into the trading branch makes `/setup-api/discovery` 404
    // here (the setup catch-all answers 200 text/html, failing the JSON `toMatchObject` below).
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-disc-"));
    const server = await startServer({
      DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_STATE_DIR: stateDir,
      WAITRON_ENV: "preproduction",
    });
    const ca = await readFile(join(stateDir, "tls", "ca.crt"));
    const { via, close } = httpsVia(ca);
    try {
      // The machine-readable discovery document: this box's hostname plus whether its CA is
      // downloadable. `caDownloadAvailable` is TRUE because the shared setup path minted the box's own
      // self-signed CA at <stateDir>/tls/ca.crt (the file `ca` above was just read from).
      const disc = await fetch(`https://127.0.0.1:${port}/setup-api/discovery`, via);
      expect(disc.status).toBe(200);
      expect(await disc.json()).toMatchObject({
        hostname: "waitron.local",
        caDownloadAvailable: true,
      });

      // The CA download — served as a named attachment so a device can install and trust it.
      const crt = await fetch(`https://127.0.0.1:${port}/setup-api/ca.crt`, via);
      expect(crt.status).toBe(200);
      expect(crt.headers.get("content-disposition")).toContain("waitron-ca.crt");

      // The server-rendered trust page — HTML, self-contained, over HTTPS.
      const trust = await fetch(`https://127.0.0.1:${port}/setup/trust`, via);
      expect(trust.status).toBe(200);
      expect(trust.headers.get("content-type")).toContain("text/html");
    } finally {
      await server.close();
      await close();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("setup mode serves an operator-supplied WAITRON_TLS_* cert while STILL generating its own box secrets", async () => {
    // The operator brings their own cert: `config.tls` is set from WAITRON_TLS_CERT_FILE/_KEY_FILE, so
    // the setup branch serves THAT leaf as the front door. But `ensureBoxSecrets` runs on EVERY setup
    // boot regardless (its two halves are independently presence-gated), so the box STILL mints its own
    // self-signed fallback cert AND generates `secrets.env` — the vault key slice 2b needs must exist
    // whichever front-door cert is served. Both facts are asserted below: the operator leaf verifies
    // (its CA, not the box CA), and `secrets.env` is written.
    //
    // Prove-by-deletion target for "operator wins": forcing the code to ignore `config.tls` (serve the
    // ensured BOX leaf instead) makes the operator-CA-trusting client's handshake fail
    // (`CERT_SIGNATURE_FAILURE`) — the box leaf is not signed by the operator CA.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-setup-op-tls-"));
    const certDir = await mkdtemp(join(tmpdir(), "waitron-boot-op-cert-"));
    // A pre-minted operator cert pair with a DISTINCTIVE identity (hostnames ["operator.example"]) so
    // it cannot be confused with the box's own fallback leaf (hostnames ["waitron.local","localhost"]);
    // it also carries 127.0.0.1 as an iPAddress SAN so a loopback dial verifies against it.
    // `mintSelfSignedServerCert` is the same minter `ensureBoxSecrets` wraps.
    const material = mintSelfSignedServerCert({
      hostnames: ["operator.example"],
      ipAddresses: ["127.0.0.1"],
      now: new Date(),
    });
    const certFile = join(certDir, "operator.crt");
    const keyFile = join(certDir, "operator.key");
    await writeFile(certFile, material.serverCertPem);
    await writeFile(keyFile, material.serverKeyPem);

    const server = await startServer({
      DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_STATE_DIR: stateDir,
      WAITRON_TLS_CERT_FILE: certFile,
      WAITRON_TLS_KEY_FILE: keyFile,
      WAITRON_ENV: "preproduction",
    });
    // Trust the OPERATOR CA (not the box-minted one): a completed handshake here proves the OPERATOR
    // leaf is what the box served. Dialling with the BOX CA would be the wrong-direction control.
    const { via, close } = httpsVia(material.caCertPem);
    try {
      // (a) HTTPS serves from the OPERATOR cert — the operator-CA client completes the handshake.
      const status = await fetch(`https://127.0.0.1:${port}/setup-api/status`, via);
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({ provisioned: false });

      // (b) The box STILL generated its own secrets under operator TLS — `secrets.env` carries the
      // vault key slice 2b loads. This is the finding this fix decoupled: gating the whole
      // `ensureBoxSecrets` call on `config.tls === undefined` would have stranded this box with none.
      expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toMatch(
        /WAITRON_CREDENTIALS_KEY=/,
      );

      // The box's OWN fallback leaf was minted too (the always-mint half), even though the operator's
      // cert is the one served — so a later boot that drops the operator vars still has a cert to serve.
      expect(existsSync(join(stateDir, "tls", "server.crt"))).toBe(true);
    } finally {
      await server.close();
      await close();
      await rm(stateDir, { recursive: true, force: true });
      await rm(certDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("setup mode: closes the app pool and rejects when startListening fails (missing operator TLS file)", async () => {
    // Copilot round 3: before this fix, the SETUP branch opened `db` (the shared prefix) but did not
    // guard against a throw inside the branch — unlike the TRADING branch's own `loadKeyRing` guard
    // just below it. `ensureBoxSecrets` itself does not throw here (it mints the box's own fallback
    // cert + secrets successfully, as the operator-TLS test above shows it always does); the throw
    // comes one line later, from `startListening` -> `buildServeOptions` -> `readFileSync` (`tls.ts`),
    // because `config.tls` is wired from `WAITRON_TLS_CERT_FILE`/`WAITRON_TLS_KEY_FILE` naming files
    // that do not exist (`config.tls` WINS over the box's own ensured leaf — same precedence the
    // operator-TLS test above exercises on the happy path). That reaches the new
    // `catch (error) { await db.close(); throw error; }` in the setup branch. This test only pins the
    // externally-observable half — `startServer` rejects — since the pool itself has no public "is it
    // closed" surface to assert on directly; the line coverage on the catch body is what proves it ran.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-setup-tls-missing-"));
    try {
      await expect(
        startServer({
          DATABASE_URL: databaseUrl,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
          // Neither path exists — `loadConfig` stores WAITRON_TLS_* verbatim with no existence check
          // (config.ts), so this reaches `readFileSync` inside `buildServeOptions` rather than failing
          // any earlier config-validation guard.
          WAITRON_TLS_CERT_FILE: join(stateDir, "does-not-exist.crt"),
          WAITRON_TLS_KEY_FILE: join(stateDir, "does-not-exist.key"),
          WAITRON_ENV: "preproduction",
        }),
      ).rejects.toThrow();
      // ensureBoxSecrets ran (and succeeded) BEFORE the failing startListening call — it is
      // unconditional in the setup branch — so the box's own secrets were generated even though the
      // boot as a whole rejected.
      expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toMatch(
        /WAITRON_CREDENTIALS_KEY=/,
      );
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("setup mode: POST /setup-api/provision provisions a demo venue, writes trading.env, stamps preproduction, and requests a restart", async () => {
    // The slice-2b full-boot proof: boot unprovisioned over HTTPS (as the 2a test above does), then
    // drive the whole provisioning flow through the real endpoint — validate + hash, `provisionVenue`
    // (stamp + `applyVenue` as the OWNER connection boot now wires), persist `trading.env`, request the
    // restart. A FRESH manifest clone (not the file-shared `suite`) keeps this isolated: `provisionVenue`
    // stamps the GLOBAL `deployment` singleton AND mints a venue, either of which would fix or pollute
    // every other test's shared DB (CLAUDE.md §4). The clone's superuser default connection OWNS the
    // manifest tables — exactly the owner connection `applyVenue` documents it needs — so both
    // `DATABASE_URL` and `WAITRON_MIGRATIONS_DATABASE_URL` point at it here (`config.migrationsDatabaseUrl`
    // is what boot opens `ownerDb` from).
    //
    // `requestRestart` defaults to `process.kill(process.pid, "SIGTERM")` (boot.ts) — which, with no
    // `bin.ts` SIGTERM handler installed under vitest, would kill this worker. `withMockedKill`
    // intercepts it the identical way `withMockedExit` intercepts the listen-failure `process.exit`.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-provision-state-"));
    const handle = resolveSharedHandle(undefined);
    const pg = await cloneTemplate(handle.uri, pickTemplate(handle, "manifest"), nextCloneName());
    const check = await pg.connect();
    try {
      await withMockedKill(async (kills) => {
        const server = await startServer({
          DATABASE_URL: pg.uri,
          WAITRON_MIGRATIONS_DATABASE_URL: pg.uri,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_ENV: "preproduction",
        });
        // Trust the CA the box minted, so the self-signed leaf verifies over the loopback dial.
        const ca = await readFile(join(stateDir, "tls", "ca.crt"));
        const { via, close } = httpsVia(ca);
        try {
          // A valid DEMO venue, no `aeatCert` (a plain demo box files nothing to AEAT).
          const body = { mode: "demo", venue: provisionVenueBody("60000009K") };
          const response = await fetch(`https://127.0.0.1:${port}/setup-api/provision`, {
            ...via,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          expect(response.status).toBe(200);
          const json = (await response.json()) as { provisioned: boolean; tenantId: string };
          expect(json.provisioned).toBe(true);

          // `trading.env` was written with the five till ids + `WAITRON_ENV` + `DATABASE_URL`, so the
          // next boot enters trading mode. Parsed (not substring-matched) so a missing key really fails.
          const trading = parseEnvLines(await readFile(join(stateDir, "trading.env"), "utf8"));
          for (const key of [
            "WAITRON_TILL_TENANT_ID",
            "WAITRON_TILL_TILL_ID",
            "WAITRON_TILL_NODE_ID",
            "WAITRON_TILL_SERIES_ID",
            "WAITRON_TILL_LOCATION_ID",
          ]) {
            expect(trading[key]).toBeTruthy();
          }
          expect(trading.WAITRON_ENV).toBe("preproduction");
          expect(trading.DATABASE_URL).toBe(pg.uri);
          // The tenant id the endpoint returned is the one persisted for the trading boot.
          expect(trading.WAITRON_TILL_TENANT_ID).toBe(json.tenantId);

          // The DB is now stamped preproduction and holds exactly one venue (one tenant, one node/SIF).
          // `check` is the clone's superuser connection, so it BYPASSES RLS and sees the true counts.
          expect(await readDeploymentEnvironment(check)).toBe("preproduction");
          const tenants = await check.execute<{ n: number }>(
            sql`select count(*)::int as n from tenants`,
          );
          expect(tenants.rows[0]!.n).toBe(1);
          const nodes = await check.execute<{ n: number }>(
            sql`select count(*)::int as n from nodes`,
          );
          expect(nodes.rows[0]!.n).toBe(1);

          // Slice 4: the provision path established the primary node's membership identity — a keypair
          // was generated, the private half sealed, and the public half stamped on `nodes.public_key`
          // — so the freshly-minted node is the venue's SOLE trust anchor. `readMembershipTrustSet`
          // scopes by `tenant_id`, so it returns exactly this venue's one keyed node. RED before boot
          // wires `establishIdentity`: `public_key` is null and the trust set is empty.
          const trust = await readMembershipTrustSet(check, json.tenantId);
          expect(Object.keys(trust)).toHaveLength(1);
          expect(Object.values(trust)[0]).toMatch(/.+/);

          // The restart was requested exactly once, AFTER the 200 flushed (setTimeout(0) in
          // setup-api.ts), as a SIGTERM to this process — the graceful-shutdown latch bin.ts installs.
          await poll(() => (kills.length > 0 ? kills.length : undefined));
          expect(kills).toEqual([{ pid: process.pid, signal: "SIGTERM" }]);
        } finally {
          await close();
          await server.close();
        }
      });
    } finally {
      await check.close();
      await pg.stop();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("setup mode: POST /setup-api/adopt is REFUSED (server.config_missing) when WAITRON_SYNC_DATABASE_URL is unset — fail loud at adopt, not at the mirror reboot", async () => {
    // Ruling 1 (Task 1): an adopted mirror MUST end up with WAITRON_SYNC_DATABASE_URL in trading.env,
    // because the next (mirror) boot's `loadMirrorSyncConfig` reads it back — without it the reboot
    // throws `server.config_missing` and the box never enters mirror mode. The POST /setup-api/adopt
    // request is the ONE interactive moment the operator can fix the deploy env, so boot's adopt
    // closure refuses HERE when `config.syncDatabaseUrl` is undefined (env lacks the var), BEFORE any
    // bundle fetch or DB write. Boot omits WAITRON_SYNC_DATABASE_URL here (the setup box was never
    // given it) and the guard fires. The body is a VALID adopt request (primaryUrl + credential), so
    // the refusal is the sync-URL guard, not a request-shape 400 (`setup.request_invalid`) — proven
    // by the `server.config_missing` code + `variable` param, not merely the 400 status. No primary is
    // ever contacted (the guard short-circuits before `fetchMirrorBundle`), and no restart is
    // requested. `databaseUrl` is the shared suite's probe role: the guard throws before any write, so
    // this test mutates nothing and needs no fresh clone.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-adopt-nosync-state-"));
    try {
      await withMockedKill(async (kills) => {
        const server = await startServer({
          DATABASE_URL: databaseUrl,
          WAITRON_MIGRATIONS_DATABASE_URL: databaseUrl,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_ENV: "preproduction",
          // Deliberately NO WAITRON_SYNC_DATABASE_URL.
        });
        const ca = await readFile(join(stateDir, "tls", "ca.crt"));
        const { via, close } = httpsVia(ca);
        try {
          const body = {
            primaryUrl: "https://primary.test/",
            credential: {
              personId: "99999999-9999-9999-9999-999999999999",
              password: "dashPass123",
            },
          };
          const response = await fetch(`https://127.0.0.1:${port}/setup-api/adopt`, {
            ...via,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          // An AppError not in ADOPT_STATUS is re-emitted at the default 400 with its own structured
          // code + params (error-boundary.ts), so this pins the CODE, not just the status.
          expect(response.status).toBe(400);
          expect(await response.json()).toEqual({
            error: {
              code: "server.config_missing",
              params: { variable: "WAITRON_SYNC_DATABASE_URL" },
            },
          });
          // The guard fired before the persist-then-restart transition, so no SIGTERM was requested
          // and no trading.env was written.
          expect(kills).toEqual([]);
          expect(existsSync(join(stateDir, "trading.env"))).toBe(false);
        } finally {
          await close();
          await server.close();
        }
      });
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("setup mode: a DEMO provision carrying an AEAT cert is REFUSED (400) — nothing provisioned or sealed", async () => {
    // Defense-in-depth over the full boot (CLAUDE.md §5): the AEAT signing cert is meaningful ONLY for
    // a LIVE ES-common venue, so a demo/preproduction body carrying one is an invalid request that the
    // endpoint refuses BEFORE `provision`. This pins that the box never seals a real AEAT signing cert
    // into a preproduction tenant's vault — the whole point of the server-side reject even though the
    // 2c client already gates the cert on live mode. FRESH-clone isolation as the demo test above.
    // Reuses `mintMtlsMaterial`'s PKCS#12 fixture (already imported for the mTLS-transport test): a
    // well-formed cert, so the refusal is the symmetric `aeatCert`-not-expected gate, not a malformed
    // cert being rejected by `validateAeatCert`. (Before this fix the same body sealed the cert and
    // returned 200 — this test was INVERTED with the behaviour change.)
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-provision-reject-state-"));
    const handle = resolveSharedHandle(undefined);
    const pg = await cloneTemplate(handle.uri, pickTemplate(handle, "manifest"), nextCloneName());
    const check = await pg.connect();
    const material = mintMtlsMaterial();
    try {
      await withMockedKill(async (kills) => {
        const server = await startServer({
          DATABASE_URL: pg.uri,
          WAITRON_MIGRATIONS_DATABASE_URL: pg.uri,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_ENV: "preproduction",
        });
        const ca = await readFile(join(stateDir, "tls", "ca.crt"));
        const { via, close } = httpsVia(ca);
        try {
          const body = {
            mode: "demo",
            venue: provisionVenueBody("60000011K"),
            aeatCert: {
              pfxBase64: material.clientPfx.toString("base64"),
              passphrase: material.clientPassphrase,
              certKind: "representante",
            },
          };
          const response = await fetch(`https://127.0.0.1:${port}/setup-api/provision`, {
            ...via,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          expect(response.status).toBe(400);
          const json = (await response.json()) as {
            error: { code: string; params: { field?: string } };
          };
          expect(json.error.code).toBe("setup.request_invalid");
          expect(json.error.params.field).toBe("aeatCert");

          // Nothing was minted and nothing was sealed — the request was refused before `provision`.
          // `check` is the clone's superuser connection, so it BYPASSES the FORCE-RLS on both tables.
          const tenants = await check.execute<{ n: number }>(
            sql`select count(*)::int as n from tenants`,
          );
          expect(tenants.rows[0]!.n).toBe(0);
          const sealed = await check.execute<{ n: number }>(
            sql`select count(*)::int as n from tenant_credentials where purpose = 'fiscal.aeat'`,
          );
          expect(sealed.rows[0]!.n).toBe(0);

          // A refused provision never schedules the restart (the setTimeout fires only on success).
          await delay(50);
          expect(kills).toEqual([]);
        } finally {
          await close();
          await server.close();
        }
      });
    } finally {
      await check.close();
      await pg.stop();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("setup mode: a LIVE ES-common provision WITH an AEAT cert seals it into the tenant's fiscal.aeat vault, stamps production, restarts", async () => {
    // The legitimate seal path end-to-end — the assertion the (now-inverted) demo+cert test used to
    // make, moved onto the CORRECT path. A LIVE ES-common venue files to the real AEAT, so its cert
    // IS expected (`certExpected` in setup-api.ts): the endpoint accepts it and `sealAeat` seals it via
    // boot.ts's real `sealAeatCredential(ownerDb, ring, …)` wiring — the ONLY full-boot exercise of
    // that binding, and of the ring `boot.ts` reads back off `secrets.env` (a broken recovery would
    // throw here). Reuses `mintMtlsMaterial`'s PKCS#12 fixture, as the mTLS-transport test does.
    //
    // No real AEAT call is made and none can be: a FRESH provision seeds NO `envios`, and a box in
    // SETUP mode never starts the drain worker (it enters trading mode only after the restart, which is
    // mocked here) — so `resolveClient`/`mtlsFetch` are never reached even though a usable `fiscal.aeat`
    // credential now exists (the transport-seam obstacle in this file's header is about the drain, not
    // the SEAL). The module-mocked `undici` fetch is the belt-and-braces backstop.
    //
    // The box boots with `WAITRON_ENV: "preproduction"` (as the demo tests above) even though this
    // provision stamps PRODUCTION: `provisionVenue` stamps `req.environment` — the endpoint's
    // mode-derived value (live → production, provision.ts:76) — NOT `config.environment`, which
    // `boot.ts` (line 528) never threads into `provisionVenue`. So this isolates the SEAL without
    // dragging in the production `loadConfig` surface (RP id/origin, credentials key). The production
    // stamp is asserted below, which proves the live fork end-to-end from the preproduction-booted box.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-provision-live-seal-state-"));
    const handle = resolveSharedHandle(undefined);
    const pg = await cloneTemplate(handle.uri, pickTemplate(handle, "manifest"), nextCloneName());
    const check = await pg.connect();
    const material = mintMtlsMaterial();
    try {
      await withMockedKill(async (kills) => {
        const server = await startServer({
          DATABASE_URL: pg.uri,
          WAITRON_MIGRATIONS_DATABASE_URL: pg.uri,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_ENV: "preproduction",
        });
        const ca = await readFile(join(stateDir, "tls", "ca.crt"));
        const { via, close } = httpsVia(ca);
        try {
          const body = {
            mode: "live",
            venue: provisionVenueBody("60000013K"),
            aeatCert: {
              pfxBase64: material.clientPfx.toString("base64"),
              passphrase: material.clientPassphrase,
              certKind: "representante",
            },
          };
          const response = await fetch(`https://127.0.0.1:${port}/setup-api/provision`, {
            ...via,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          expect(response.status).toBe(200);
          const json = (await response.json()) as { provisioned: boolean; tenantId: string };
          expect(json.provisioned).toBe(true);

          // The live fork stamped PRODUCTION (mode-derived, not the box's preproduction boot env).
          // `check` is the clone's superuser connection, so it BYPASSES RLS on both reads.
          expect(await readDeploymentEnvironment(check)).toBe("production");

          // Exactly one `fiscal.aeat` credential was sealed, for the tenant just provisioned — the real
          // `sealAeatCredential` wiring (boot.ts:529) ran end-to-end.
          const sealed = await check.execute<{ n: number; tenant: string }>(
            sql`select count(*)::int as n, max(tenant_id::text) as tenant
                from tenant_credentials where purpose = 'fiscal.aeat'`,
          );
          expect(sealed.rows[0]!.n).toBe(1);
          expect(sealed.rows[0]!.tenant).toBe(json.tenantId);

          // The restart fires once after the seal + persist, as for the plain demo above.
          await poll(() => (kills.length > 0 ? kills.length : undefined));
          expect(kills).toEqual([{ pid: process.pid, signal: "SIGTERM" }]);
        } finally {
          await close();
          await server.close();
        }
      });
    } finally {
      await check.close();
      await pg.stop();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("boots in trading mode when a venue is bound: mounts the trading API and NOT the setup routes", async () => {
    // The regression guard for the branch: a provisioned box (all five WAITRON_TILL_*_ID + a
    // credentials key, via KEY_ENV) runs today's exact trading flow — the till API is mounted — and the
    // setup routes are NOT mounted (so /setup-api/status is a bare 404, never the setup fact sheet).
    // This is the prove-by-deletion target: forcing `config.till` always-undefined takes the setup
    // branch, so /setup-api/status returns the 200 fact sheet (failing the 404 assertion below) and
    // /api/staff is answered by `mountSetup`'s `GET *` catch-all as a 200 text/html placeholder (a bare
    // 404 is impossible while that catch-all is mounted — the sibling test above says so) — which fails
    // this test at `await staff.json()`, a parse error on HTML, not at the status assertion.
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "production",
      WAITRON_MIN_TICK_MS: "50",
      WAITRON_MAX_TICK_MS: "200",
      WAITRON_SKIP_RETRY_MS: "100",
    });
    try {
      // The trading surface is live: the unauthenticated roster route returns this till's (empty) staff
      // list under RLS — 200 [], not 404 — exactly as the first test in this block asserts.
      const staff = await fetch(`http://127.0.0.1:${port}/api/staff`);
      expect(staff.status).toBe(200);
      expect(await staff.json()).toEqual([]);

      // The setup surface is absent in trading mode: /setup-api/status is a bare Hono 404 (no setup
      // routes, and no till SPA catch-all here since WAITRON_TILL_APP_DIR is unset), never the
      // { provisioned: false, ... } fact sheet a setup box serves.
      const status = await fetch(`http://127.0.0.1:${port}/setup-api/status`);
      expect(status.status).toBe(404);
    } finally {
      await server.close();
    }
  }, 60_000);

  it("trading mode does NOT mount the setup-only discovery routes (slice 3), and the trading surface is unchanged", async () => {
    // Slice 3's discovery/CA/trust surface is mounted in the SETUP branch only. A provisioned box
    // (all five WAITRON_TILL_*_ID + a credentials key, via KEY_ENV) mounts NONE of it: /setup-api/
    // discovery is a bare Hono 404 (no setup routes, no till SPA catch-all here — WAITRON_TILL_APP_DIR
    // is unset), while today's trading routes (/api/staff, /health) still answer exactly as before —
    // the mDNS start/stop added to the shared prefix is the only trading-path change. The real
    // multicast-dns socket this boot now starts is torn down by server.close() below (→ mdns.stop()).
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "production",
      WAITRON_MIN_TICK_MS: "50",
      WAITRON_MAX_TICK_MS: "200",
      WAITRON_SKIP_RETRY_MS: "100",
    });
    try {
      const disc = await fetch(`http://127.0.0.1:${port}/setup-api/discovery`);
      expect(disc.status).toBe(404);
      // And the CA download + trust page are equally absent in trading mode.
      expect((await fetch(`http://127.0.0.1:${port}/setup-api/ca.crt`)).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}/setup/trust`)).status).toBe(404);

      // The trading surface is unchanged: the unauthenticated roster route answers this till's empty
      // staff list under RLS (200 [], not 404), and /health still answers its JSON.
      const staff = await fetch(`http://127.0.0.1:${port}/api/staff`);
      expect(staff.status).toBe(200);
      expect(await staff.json()).toEqual([]);

      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      expect((await health.json()) as { ok: boolean }).toMatchObject({ ok: true });
    } finally {
      await server.close();
    }
  }, 60_000);

  it("serves the built till at / and dashboard at /manage when the app dirs are configured, without shadowing the APIs", async () => {
    // The one boot that sets WAITRON_TILL_APP_DIR / WAITRON_DASHBOARD_APP_DIR — every other boot in
    // this suite leaves them unset (the dev/Vite case), so this is what drives boot.ts's two SPA-mount
    // branches and `mountSpa`'s wiring end to end. Two throwaway built-SPA dirs (index.html + a
    // dashboard asset) stand in for Task 1's real Vite output; distinctive markers so a swapped
    // /manage-vs-/ mapping would be caught. `boot.spa-mount.test.ts` pins the mount ORDER at the Hono
    // level; this proves the same wiring survives a real startServer and does not shadow /health or
    // /api/staff (the till root catch-all is registered LAST, after every API route).
    const tillApp = mkdtempSync(join(tmpdir(), "waitron-boot-till-spa-"));
    const dashApp = mkdtempSync(join(tmpdir(), "waitron-boot-dash-spa-"));
    writeFileSync(join(tillApp, "index.html"), "<html>till-spa-root</html>");
    writeFileSync(join(dashApp, "index.html"), "<html>dashboard-spa-root</html>");
    mkdirSync(join(dashApp, "assets"));
    writeFileSync(join(dashApp, "assets", "d-1.js"), "// dashboard-spa-asset");
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "production",
      WAITRON_TILL_APP_DIR: tillApp,
      WAITRON_DASHBOARD_APP_DIR: dashApp,
    });
    try {
      // The till at the origin root, the dashboard at /manage — the two SPA branches both mounted.
      const till = await fetch(`http://127.0.0.1:${port}/`);
      expect(till.status).toBe(200);
      expect(till.headers.get("content-type")).toContain("text/html");
      expect(await till.text()).toContain("till-spa-root");

      const dash = await fetch(`http://127.0.0.1:${port}/manage/`);
      expect(dash.status).toBe(200);
      expect(await dash.text()).toContain("dashboard-spa-root");

      const asset = await fetch(`http://127.0.0.1:${port}/manage/assets/d-1.js`);
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain("dashboard-spa-asset");

      // The catch-all did NOT shadow the APIs or /health: /health still answers its JSON, and the
      // unauthenticated roster route still returns its empty array (200, not the SPA's index.html).
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      expect((await health.json()) as { ok: boolean }).toMatchObject({ ok: true });

      const staff = await fetch(`http://127.0.0.1:${port}/api/staff`);
      expect(staff.status).toBe(200);
      expect(await staff.json()).toEqual([]);
    } finally {
      await server.close();
      rmSync(tillApp, { recursive: true, force: true }); // guarded teardown (CLAUDE.md §4)
      rmSync(dashApp, { recursive: true, force: true });
    }
  }, 60_000);

  it("mounts the peer-authenticated sync API and starts the pull worker AND the retention sweep when WAITRON_SYNC_* is configured", async () => {
    // The sync transport is enabled by WAITRON_SYNC_PEERS. The peer URL is unreachable, so the pull
    // worker's one handshake attempt goes through fetchHttpClient (undici's fetch, MOCKED to reject in
    // this file) and the peer backs off — which is all this test needs from the worker: it exercises
    // the production HttpClient adapter and the boot wiring without a second live node. /sync-api/hello
    // with an enrolled peer's token proves mountSyncApi ran with this node's till.nodeId AND that the
    // auth path resolves against sync_peers (Task 5); a tokenless request proves the fail-closed guard
    // is live. The sync DB URL is a sync_applier (app_user + sync_tailer) URL — the auth path now reads
    // sync_peers, which the app-only deployment role cannot; the worker never reaches a sync_log read
    // (it fails at the peer handshake first). close() must tear the worker + pool down alongside the
    // main loop.
    //
    // WAITRON_SYNC_RETENTION_DATABASE_URL is also set (reusing the deployment role), so this same boot
    // schedules the retention sweep (spec §3.2 — what finally wires pruneSyncLog). runRetentionSweep is
    // mocked (call-through) in this file, so the assertions below observe the CALL — started once, with
    // the configured tickMs and the SAME AbortSignal the pull workers share — and close() tears its
    // pool down too. A large retention tick keeps the real call-through sweep to a single prune attempt
    // before close() aborts it.
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
      WAITRON_SYNC_DATABASE_URL: syncDatabaseUrl,
      // Distinct from the ordered lane's minTickMs default (5000) so the two lanes' idle intervals
      // are visibly different in the assertions below (spec §4d).
      WAITRON_SYNC_FAST_TICK_MS: "250",
      // Enable the retention sweep, reusing the deployment role. A large, distinctive tick so the
      // call-through sweep runs at most one prune before close() aborts it, and so the assertion below
      // cannot pass by coincidence with any other tick value in this env.
      WAITRON_SYNC_RETENTION_DATABASE_URL: databaseUrl,
      WAITRON_SYNC_RETENTION_TICK_MS: "33000",
      // The lag alarm is opt-in (spec §3.2). A distinctive value so the pass-through assertion below
      // cannot pass by coincidence with any other number in this env — proves config → boot wires the
      // threshold into runRetentionSweep, which is what makes sync.stream_stalled reachable in prod.
      WAITRON_SYNC_LAG_ALARM_ROWS: "7",
    });
    try {
      const hello = await fetch(`http://127.0.0.1:${port}/sync-api/hello`, {
        headers: { Authorization: `Bearer ${syncPeerToken}` },
      });
      expect(hello.status).toBe(200);
      expect(await hello.json()).toEqual({
        nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
        environment: "production",
        membership: null, // no document adopted → the handshake carries a null membership (design §5)
      });
      // A tokenless request is refused — the fail-closed guard, not just the route, is live.
      const unauth = await fetch(`http://127.0.0.1:${port}/sync-api/hello`);
      expect(unauth.status).toBe(401);
      // Give the pull worker a beat to make its (failing) peer handshake, exercising fetchHttpClient.
      await delay(100);

      // TWO lane-scoped pull workers were started against the same peer: ordered at config.minTickMs
      // and fast at fastMinIdleMs (spec §4d). Assert the two calls' lane + minIdleMs pairing.
      const calls = vi.mocked(runSyncPull).mock.calls.map((c) => c[0]);
      const ordered = calls.find((d) => d.lane === "ordered");
      const fast = calls.find((d) => d.lane === "fast");
      expect(ordered).toBeDefined();
      expect(fast).toBeDefined();
      expect(ordered!.minIdleMs).toBe(5_000); // config.minTickMs default
      expect(fast!.minIdleMs).toBe(250); // WAITRON_SYNC_FAST_TICK_MS below
      expect(fast!.maxBackoffMs).toBe(ordered!.maxBackoffMs); // both share config.maxTickMs

      // The retention sweep was scheduled exactly once (spec §3.2) — this boot is what finally wires
      // pruneSyncLog into the running host. Its tickMs is WAITRON_SYNC_RETENTION_TICK_MS, and it shares
      // the SAME AbortSignal the pull workers carry, so close()'s single syncController.abort() below
      // stops the sweep too.
      expect(runRetentionSweep).toHaveBeenCalledTimes(1);
      const sweep = vi.mocked(runRetentionSweep).mock.calls[0]![0];
      expect(sweep.tickMs).toBe(33_000);
      expect(sweep.signal).toBe(ordered!.signal); // one controller aborts pull workers AND the sweep
      // The configured lag threshold reached runRetentionSweep — so its sync.stream_stalled branch is
      // now live in prod when WAITRON_SYNC_LAG_ALARM_ROWS is set (spec §3.2, the wiring B8 omitted).
      expect(sweep.lagAlarmRows).toBe(7);
    } finally {
      await server.close();
    }
    await expect(fetch(`http://127.0.0.1:${port}/sync-api/hello`)).rejects.toThrow(); // listener gone
  }, 60_000);

  it("boot reads a REAL trust set, so its adoptMembership callback accepts a trusted, strictly-newer document (Slice 4)", async () => {
    // The now-live seam: boot reads `membershipTrustSet` from `nodes.public_key` (Slice 4), not the old
    // empty `{}`. Stamp a node the venue trusts, boot, then drive boot's OWN `adoptMembership` callback
    // with a document that node signed — the accept fence passes, the term-guarded persist writes
    // node_membership, and the `if (outcome.accepted)` log fires. This is the branch that carried the
    // now-false `/* v8 ignore */` while the seam was empty; here it is covered through boot.ts itself.
    // The peer is unreachable (so the live worker never adopts), so we invoke the captured callback boot
    // handed runSyncPull directly rather than standing up a live source — that end-to-end pull → adopt is
    // proven separately in membership-gossip.e2e.test.ts.
    const SIGNER = "77777777-7777-4777-8777-777777777777";
    const kp = generateNodeKeyPair();
    // Stamp the trusted node BEFORE boot: `membershipTrustSet` is read once at startup, so the row must
    // exist first. Inserted as the container superuser (RLS bypassed), tenant-scoped to this venue.
    await suite.admin.execute(sql`
      insert into nodes (id, tenant_id, location_id, name, public_key)
      values (${SIGNER}, ${TILL_ENV.WAITRON_TILL_TENANT_ID}, ${TILL_ENV.WAITRON_TILL_LOCATION_ID},
              'Trusted primary', ${kp.publicKey})`);
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
      WAITRON_SYNC_DATABASE_URL: syncDatabaseUrl,
    });
    try {
      // Boot handed the same `adoptMembership` callback to both lane workers; grab the ordered lane's.
      const ordered = vi
        .mocked(runSyncPull)
        .mock.calls.map((c) => c[0])
        .find((d) => d.lane === "ordered");
      expect(ordered?.adoptMembership).toBeDefined();
      // Nothing adopted yet — the singleton is empty.
      expect(await readNodeMembership(suite.admin)).toBeNull();
      // Drive boot's real callback with a term-5 document the stamped node signed. Because boot's trust
      // set now maps SIGNER → kp.publicKey, the accept fence passes and the persist lands.
      await ordered!.adoptMembership!(
        signedMembershipDoc(5, { signerNodeId: SIGNER, keyPair: kp }),
      );
      const held = await readNodeMembership(suite.admin);
      expect(held).not.toBeNull();
      expect(held!.body.term).toBe(5);
      expect(held!.signerNodeId).toBe(SIGNER);
    } finally {
      await server.close();
      // node_membership is a whole-DB singleton and this suite's DB is shared, so clear both writes to
      // keep the sync tests that assert `membership: null` order-independent (this file's own rule).
      await suite.admin.execute(sql`delete from node_membership`);
      await suite.admin.execute(sql`delete from nodes where id = ${SIGNER}`);
    }
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
      WAITRON_SYNC_DATABASE_URL: syncDatabaseUrl,
    });

    // The listener is up before close(): the sync source mounted and bound.
    const hello = await fetch(`http://127.0.0.1:${port}/sync-api/hello`, {
      headers: { Authorization: `Bearer ${syncPeerToken}` },
    });
    expect(hello.status).toBe(200);

    // The UNSET-retention case (spec §3.2/§8): sync is on but WAITRON_SYNC_RETENTION_DATABASE_URL is
    // not set here, so the sweep is NOT scheduled — an existing sync host without the retention role
    // boots unaffected (it logs sync.retention_unconfigured instead). The beforeEach cleared this spy,
    // so a call from the retention-configured test above cannot leak into this assertion.
    expect(runRetentionSweep).not.toHaveBeenCalled();

    // close() RESOLVES despite the worker rejection (the swallow), and the guaranteed teardown ran: the
    // listener is gone — which it could only be if close() got PAST the swallowed worker await into the
    // try (server.close), whose finally then closed both the app pool and the sync pool.
    await expect(server.close()).resolves.toBeUndefined();
    await expect(fetch(`http://127.0.0.1:${port}/sync-api/hello`)).rejects.toThrow();
  }, 60_000);

  it("close() swallows a REJECTING retention sweep worker and still tears down the listener and pools", async () => {
    // The retention worker's own settle-by-rejection path, mirroring the pull-worker test above.
    // runRetentionSweep swallows its per-tick faults so it never rejects in production, but boot
    // attaches a `.catch` logging sync.worker_rejected for the pre-close() window, and close() must
    // still tear down if it settles by rejection. Force exactly that: a pre-rejected worker returned
    // once from the mocked runRetentionSweep, carrying its OWN benign `.catch` so it is never an
    // unhandled rejection before boot's catch attaches. close() RESOLVES and the listener is gone.
    const port = await freePort();
    const workerBoom = new Error("retention sweep worker rejected");
    const rejectedWorker = Promise.reject(workerBoom);
    rejectedWorker.catch(() => {}); // handled here, so never an unhandled rejection pre-close()
    vi.mocked(runRetentionSweep).mockReturnValueOnce(rejectedWorker);

    const server = await startServer({
      ...KEY_ENV,
      DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "production",
      WAITRON_SYNC_PEERS: JSON.stringify([
        {
          nodeId: "88888888-8888-4888-8888-888888888888",
          url: "http://127.0.0.1:1/",
          token: "peer-token",
        },
      ]),
      WAITRON_SYNC_DATABASE_URL: syncDatabaseUrl,
      // Retention configured, so the sweep is started (and here rejected) and its pool is torn down.
      WAITRON_SYNC_RETENTION_DATABASE_URL: databaseUrl,
    });

    // The listener is up before close(): the sync source mounted and bound.
    const hello = await fetch(`http://127.0.0.1:${port}/sync-api/hello`, {
      headers: { Authorization: `Bearer ${syncPeerToken}` },
    });
    expect(hello.status).toBe(200);

    // The alarm is opt-in: WAITRON_SYNC_LAG_ALARM_ROWS is unset here, so boot passes lagAlarmRows
    // undefined and the sweep is prune-only (its sync.stream_stalled branch never runs). The
    // complementary direction to the "set → 7" assertion in the retention-scheduled test above.
    expect(vi.mocked(runRetentionSweep).mock.calls[0]![0].lagAlarmRows).toBeUndefined();

    // close() RESOLVES despite the retention worker rejection (the swallow), and the guaranteed
    // teardown ran: the listener is gone, which it could only be if close() got PAST the swallowed
    // retention-worker await into the try, whose finally then closed the app, sync, and retention pools.
    await expect(server.close()).resolves.toBeUndefined();
    await expect(fetch(`http://127.0.0.1:${port}/sync-api/hello`)).rejects.toThrow();
  }, 60_000);

  it("dials the outbound cloud-mirror tunnel to config.httpPort when WAITRON_TUNNEL_* is set, and close() aborts it", async () => {
    // The tunnel is enabled by WAITRON_TUNNEL_RELAY_URL (loadTunnelConfig). The relay is unreachable
    // (127.0.0.1:1), so the real call-through client's pool slots just fail to establish and back off —
    // all this test needs from the client, which it drives through realSleep exactly as the sync test
    // drives the pull worker against an unreachable peer. What it asserts is the boot WIRING: the client
    // is started once with the configured relay host/port/boxId/token, the box's OWN served port as
    // localPort (config.httpPort — the same listener startListening binds), the operator's pool size,
    // and the boot AbortSignal. close() then aborts that signal (its stopWork path), which is what tears
    // the client down.
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "production",
      // A relay url whose host + port the box dials out to. Unreachable on purpose (port 1), so the
      // call-through client backs off rather than pairing — the same unreachable-endpoint shape the sync
      // worker test uses. A distinctive pool size so the pass-through assertion below cannot pass by
      // coincidence with the client's own default (4).
      WAITRON_TUNNEL_RELAY_URL: "tcp://127.0.0.1:1",
      WAITRON_TUNNEL_BOX_ID: "box-mirror-7",
      WAITRON_TUNNEL_TOKEN: "tunnel-secret",
      WAITRON_TUNNEL_POOL_SIZE: "3",
    });
    try {
      expect(runTunnelClient).toHaveBeenCalledTimes(1);
      const deps = vi.mocked(runTunnelClient).mock.calls[0]![0];
      // The box's OWN served port — a paired connection is spliced to the exact listener bound below.
      expect(deps.localPort).toBe(port);
      expect(deps.relayHost).toBe("127.0.0.1");
      expect(deps.relayPort).toBe(1);
      expect(deps.boxId).toBe("box-mirror-7");
      expect(deps.token).toBe("tunnel-secret");
      expect(deps.poolSize).toBe(3); // WAITRON_TUNNEL_POOL_SIZE, threaded through so the knob is live
      // The boot signal, not yet aborted while the host runs.
      expect(deps.signal.aborted).toBe(false);
      // ...and close() aborts exactly that signal (stopWork), which is what tears the client down.
      await server.close();
      expect(deps.signal.aborted).toBe(true);
    } finally {
      await server.close(); // idempotent; guarantees teardown even if an assertion above threw
    }
  }, 60_000);

  it("does not dial the tunnel when WAITRON_TUNNEL_* is unset", async () => {
    // The off-switch: no WAITRON_TUNNEL_RELAY_URL, so loadTunnelConfig returns undefined and boot dials
    // nothing (it logs the tunnel-off line and starts no client). Every other boot in this suite is this
    // case; asserting it explicitly here — with the beforeEach-cleared spy — pins that a plain trading
    // boot never starts the tunnel worker.
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "production",
    });
    try {
      expect(runTunnelClient).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  }, 60_000);

  it("does not schedule the backup sweep when WAITRON_BACKUP_DIR is unset, and boots unaffected", async () => {
    // The backup off-switch (slice 4b-ii): no WAITRON_BACKUP_DIR, so loadBackupConfig returns undefined
    // and boot runs neither the RLS probe nor the sweep — it logs the backup-off line and leaves backup
    // OFF. Every OTHER trading boot in this suite is this same case (none sets WAITRON_BACKUP_*), so the
    // real guard is that they all still pass; this asserts the off branch explicitly. Proven via the
    // logged backup.disabled event (the wiring ran the else branch) plus a clean shutdown. Box-status's
    // own configured:false report on this branch is covered directly by box-status.route.test.ts.
    const port = await freePort();
    const [server, disabled] = await withCapturedStdout(async (lines) => {
      const started = await startServer({
        ...KEY_ENV,
        DATABASE_URL: databaseUrl,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "production",
      });
      const event = await waitForEvent(lines, "backup.disabled");
      return [started, event] as const;
    });
    try {
      expect(disabled.event).toBe("backup.disabled");
    } finally {
      await server.close();
    }
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow(); // listener gone
  }, 60_000);

  it("boots and TRADES when the backup DB is unreachable — the RLS probe failure disables backup, never aborts boot (§5)", async () => {
    // The strict CLAUDE.md §5 case, driven through startServer rather than reasoned about: WAITRON_BACKUP_DIR
    // is set (so loadBackupConfig returns a config and the probe runs) but WAITRON_BACKUP_DATABASE_URL points
    // at a REFUSED port (127.0.0.1:1 — connection refused, resolves fast and deterministically, not a hang).
    // The probe's createPostgresDb therefore throws; boot's fail-safe catch swallows it, logs
    // backup.disabled_probe_failed, and leaves backup OFF. What must hold: startServer RESOLVES (a bad backup
    // role must not brick the till), /health serves (the box trades), and box-status reports
    // backup.configured:false (backup left off). Uses a real container for the MAIN db as every trading boot
    // here does; only the backup URL is the dead one.
    const port = await freePort();
    const backupDir = mkdtempSync(join(tmpdir(), "waitron-boot-backup-"));
    const [server, disabled] = await withCapturedStdout(async (lines) => {
      const started = await startServer({
        ...KEY_ENV,
        DATABASE_URL: databaseUrl,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "production",
        WAITRON_BACKUP_DIR: backupDir,
        // Port 1 → ECONNREFUSED, fast and deterministic (a refused port, never a hanging one).
        WAITRON_BACKUP_DATABASE_URL: "postgres://user:pw@127.0.0.1:1/db",
      });
      // The probe's createPostgresDb/assert failure was caught and backup left OFF — proven by the log line,
      // whose arrival also means startServer got past the probe rather than throwing out of it.
      const event = await waitForEvent(lines, "backup.disabled_probe_failed");
      // Then wait for the first pass to complete (loop.sleeping is logged strictly after onPass ->
      // recordPass, same as the main boot test) so /health has flipped past its pre-first-pass 503 startup
      // grace — the box genuinely trades, and with no due fiscal work seeded both duties report ok.
      await waitForEvent(lines, "loop.sleeping");
      return [started, event] as const;
    });
    try {
      // startServer RESOLVED (we hold a StartedServer) and the till TRADES: /health answers 200.
      expect(disabled.event).toBe("backup.disabled_probe_failed");
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      // The captured backup.disabled_probe_failed line means backupWorker stayed undefined, so mountBoxStatusApi
      // received readBackup: undefined — and box-status's `backup: { configured: false }` for that exact
      // undefined-reader case is asserted directly (over the management gate) in box-status.route.test.ts, so
      // it is not re-proven behind a manager login here (boot.test.ts seeds no manager identity — that would
      // be the heavy scaffolding the slice brief says to avoid).
    } finally {
      await server.close();
      rmSync(backupDir, { recursive: true, force: true });
    }
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow(); // listener gone
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

// The REJECT test below needs no real container: an at-or-above-budget `WAITRON_MAX_TICK_MS` is
// rejected by this guard at the very top of `startServer`, before it ever reaches the stamp probe or
// `applyMigrations` — a deliberately unreachable `DATABASE_URL` proves that (a real one would make the
// rejection ambiguous between this guard and an actual connection failure that happened to also
// throw). The ACCEPT test DOES need the container `beforeAll` starts for the suite above: since slice
// 1b `loadKeyRing` lives at the top of boot's trading branch — AFTER the stamp probe and migrations —
// so the below-budget value's proof (reaching `credentials.key_missing` at `loadKeyRing`) only lands
// once those have run against a reachable database.
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
    // The guard is at the very top of `startServer`, but `loadKeyRing` now lives at the top of boot's
    // TRADING branch — after the shared deployment-stamp probe and `applyMigrations` — so proving a
    // below-budget value passes the guard means reaching that later throw against a REACHABLE database.
    // `...TILL_ENV` makes `config.till` present (trading mode) while every WAITRON_CREDENTIALS_KEY*
    // variable is omitted, so a boot that gets past the guard, the stamp probe and migrations (against
    // the real, unstamped container) throws `credentials.key_missing` at `loadKeyRing`. Reaching THAT
    // error, not `server.config_invalid`/`at_or_above_drain_budget`, is what proves the guard let this
    // value through rather than rejecting it for the wrong reason.
    const error = await captureError(() =>
      startServer({
        ...TILL_ENV,
        DATABASE_URL: databaseUrl,
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
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

describe("SP-C dev override reaches the live device routes only under devMode", () => {
  // The end-to-end proof that Task 6's boot wiring threads `config.devMode` all the way to the live
  // routes: `mountDeviceApi` must receive `devMode: config.devMode`, and the `/api/device/me` route
  // (which reconstructs a NARROW `{ db, cfg }` for `requireDevice`) must forward `devMode` so the
  // `x-waitron-dev-device` override header is honoured. The security invariant is the fail-closed
  // half: a NON-dev boot (`WAITRON_ENV=preproduction`) must IGNORE the header entirely — proven at
  // the HTTP layer, not reasoned about. Both boots are TRADING mode (all five WAITRON_TILL_*_ID via
  // KEY_ENV), so `mountDeviceApi` is mounted; only `WAITRON_ENV` differs between them.
  //
  // Two devices are enrolled (bound to two DIFFERENT tills) so the assertion proves the header
  // SELECTS a specific device rather than defaulting to whatever one device happens to exist:
  // `/api/device/me` returns device-2's id AND device-2's bound `tillId`, not device-1's. Enrolled
  // via the genuine mint->redeem path (`generatePairingCode` + `enrolDevice`) on the app role under
  // the tenant, exactly as `sale-till-source.receipt.test.ts` does — though the override path never
  // checks the token, the real enrol path proves the wiring against a genuinely-provisioned device.
  let deviceId1: string;
  let deviceId2: string;
  let till2: string;

  beforeAll(async () => {
    const cfg: TillConfig = { ...loadTillConfig(TILL_ENV), orderFlow: "prepay" };
    // Two `tills` rows in this till's own tenant/location, inserted as the container superuser (RLS
    // bypassed, exactly as the tenant/location seed above). The (tenant_id, till_id) composite FK on
    // `devices` (MATCH SIMPLE, both columns non-null here) requires a real row per bound device.
    const insertTill = async (name: string): Promise<string> => {
      const res = await suite.admin.execute<{ id: string }>(sql`
        insert into tills (tenant_id, location_id, name)
        values (${TILL_ENV.WAITRON_TILL_TENANT_ID}, ${TILL_ENV.WAITRON_TILL_LOCATION_ID}, ${name})
        returning id`);
      return res.rows[0]!.id;
    };
    const till1 = await insertTill("SP-C dev override till 1");
    till2 = await insertTill("SP-C dev override till 2");
    // Enrol a `till`-kind device bound to `boundTillId` and return its id — the mint->redeem runs on
    // the app role under the tenant (the production enrol path), so `tryReadDevice`'s id-selected,
    // RLS-scoped, `active = true` read resolves a genuine binding.
    const enrolTillDevice = async (boundTillId: string): Promise<string> => {
      const { code } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return generatePairingCode(tx, cfg, {
          kind: "till",
          stationId: null,
          tillId: boundTillId,
          canvasId: null,
          label: "SP-C dev override device",
        });
      });
      const dev = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return enrolDevice(tx, cfg, { code });
      });
      return dev.deviceId;
    };
    deviceId1 = await enrolTillDevice(till1);
    deviceId2 = await enrolTillDevice(till2);
  }, 60_000);

  it("under devMode, the x-waitron-dev-device header authenticates AS that device on /api/device/me (no cookie)", async () => {
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "dev",
      WAITRON_MIN_TICK_MS: "50",
      WAITRON_MAX_TICK_MS: "200",
      WAITRON_SKIP_RETRY_MS: "100",
    });
    try {
      // The header names device-2; the response is device-2's binding — proof the override reached
      // `requireDevice` through the reconstructed `{ db, cfg }` (with `devMode` now forwarded), and
      // that it SELECTED the named device (its own bound `tillId`), not device-1 or a default.
      const res = await fetch(`http://127.0.0.1:${port}/api/device/me`, {
        headers: { [DEV_DEVICE_HEADER]: deviceId2 },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { deviceId: string; tillId: string | null };
      expect(body.deviceId).toBe(deviceId2);
      expect(body.tillId).toBe(till2);
    } finally {
      await server.close();
    }
  }, 60_000);

  it("a boot NOT in devMode ignores the header (401 with no cookie)", async () => {
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
      WAITRON_MIN_TICK_MS: "50",
      WAITRON_MAX_TICK_MS: "200",
      WAITRON_SKIP_RETRY_MS: "100",
    });
    try {
      // Same header, same enrolled device — but `config.devMode` is false, so the override is
      // byte-for-byte inert: `tryReadDevice` never reads the header and, with no cookie, folds to
      // `device.unauthorized` (401). This is the fail-closed security invariant at the HTTP layer.
      const res = await fetch(`http://127.0.0.1:${port}/api/device/me`, {
        headers: { [DEV_DEVICE_HEADER]: deviceId1 },
      });
      expect(res.status).toBe(401);
    } finally {
      await server.close();
    }
  }, 60_000);
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

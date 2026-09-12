import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSingletonRole, stampDeployment, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { runTunnelClient } from "@waitron/tunnel";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
import { roleUrl } from "./testing/postgres.js";

// The primary-only SINGLETON duties (scheduled backup, outbound tunnel client) gate on `singleton_role`,
// not on `mode` (promotion #158 follow-on). Since swap step 4 the outbox sync SOURCE and retention sweep
// are deleted, so two singleton duties remain; this suite pins the topology no other boot suite exercises
// WITH THE SINGLETON-DUTY CONFIGS WIRED: a SELL-ONLY LOCAL SECONDARY — `deployment.mode='primary'` AND
// `singleton_role='secondary'` — which is NOT a mirror (so `isMirror` is false and the old `!isMirror`
// gate ran all of them, the active-active duplication this gate fixes) yet must run NEITHER, because the
// one singleton primary owns them. TWO manifest clones of the SAME identity: a `(primary, secondary)` one
// that runs neither, and a default-`primary` one that runs both — the control proving the secondary's
// absence is real, not a boot that silently wired nothing (CLAUDE.md §1). Real Postgres, not PGlite: the
// boot reads `deployment` as the non-superuser app role, whose grants PGlite's superuser connection
// would not enforce.

vi.mock("@waitron/tunnel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/tunnel")>();
  return {
    ...actual,
    runTunnelClient: vi.fn(actual.runTunnelClient),
  };
});

// One shared module mock accumulates calls across tests, so clear the spy before each so the call-count
// assertions stay order-independent (boot.test.ts's own rule). `mockClear` keeps the spy's
// `vi.fn(actual.*)` call-through implementation, resetting only `mock.calls`.
beforeEach(() => {
  vi.mocked(runTunnelClient).mockClear();
});

const secondary = useTemplateDb({ template: "manifest" });
const primary = useTemplateDb({ template: "manifest" });

// The till's fiscal identity — the five WAITRON_TILL_*_ID that put boot into TRADING mode (a secondary is
// a trading boot: it sells, it just files nothing and owns no singletons). Seeded on both clones so
// `readOrderFlow` / `readVenueLocale` resolve and the sync source (on the primary control) names this node.
const TILL_ENV = {
  WAITRON_TILL_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

// A `modules.json` resolving the two-member fiscal slot to Veri*Factu (disabling `fiscal-none`), so a
// trading boot does not refuse `module.fiscal_slot_ambiguous` under the default-on both-enabled set.
const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-singleton-state-"));
writeFileSync(
  join(STATE_ROOT, "modules.json"),
  JSON.stringify({ modules: { "fiscal-none": false } }),
);
const KEY_ENV = {
  // Task 3: keep the plain-HTTP landing listener (default port 80) OUT of every boot test — 80 is
  // privileged, and a root CI container would otherwise stand up a live service on it. Its own
  // behaviour is proven directly in landing-listener.test.ts.
  WAITRON_HTTP_LANDING_PORT: "0",
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_STATE_DIR: STATE_ROOT,
  WAITRON_ENV: "preproduction",
  ...TILL_ENV,
};

let migrationsRoot: string;
let backupDir: string;
let secondaryDatabaseUrl: string;
let primaryDatabaseUrl: string;

/**
 * Seed the FK identity (tenant, location, node, till, series) with the WAITRON_TILL_*_ID on one
 * clone, as the container superuser — mirrors boot.mirror.test.ts's `seedIdentity`.
 */
async function seedIdentity(admin: Database): Promise<void> {
  await admin.execute(sql`insert into tenants (id, country, tax_id, legal_name)
    values (${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'ES', '90333333P', 'Secondary SL') on conflict do nothing`);
  await admin.execute(sql`insert into locations (id, tenant_id, name, invoice_locales, operation_description)
    values (${TILL_ENV.WAITRON_TILL_LOCATION_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'Loc',
            array['en']::text[], 'Hospitality') on conflict do nothing`);
  await admin.execute(sql`insert into nodes (id, tenant_id, location_id, name)
    values (${TILL_ENV.WAITRON_TILL_NODE_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID},
            ${TILL_ENV.WAITRON_TILL_LOCATION_ID}, 'Node') on conflict do nothing`);
  await admin.execute(sql`insert into tills (id, tenant_id, location_id, name)
    values (${TILL_ENV.WAITRON_TILL_TILL_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID},
            ${TILL_ENV.WAITRON_TILL_LOCATION_ID}, 'Till') on conflict do nothing`);
  await admin.execute(sql`insert into invoice_series (id, tenant_id, node_id, code)
    values (${TILL_ENV.WAITRON_TILL_SERIES_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID},
            ${TILL_ENV.WAITRON_TILL_NODE_ID}, 'A') on conflict do nothing`);
}

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-singleton-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  backupDir = await mkdtemp(join(tmpdir(), "waitron-singleton-backup-"));

  await seedIdentity(secondary.admin);
  await seedIdentity(primary.admin);

  // The sell-only local secondary: stamp preproduction (so the deployment guard passes and
  // `setSingletonRole` has a row to update), then set singleton_role='secondary'. The mode column keeps
  // its default 'primary' — this is a `(primary, secondary)` node, valid under `deployment_role_valid_ck`
  // (a mirror could not hold 'secondary' this way; only a real primary-mode box can be a local secondary).
  // Owner-role writes (app_user holds no UPDATE on deployment), so they run on the superuser admin.
  await stampDeployment(secondary.admin, "preproduction");
  await setSingletonRole(secondary.admin, "secondary");
  // The control keeps the column default ('primary', 'primary') — the singleton primary that owns both.
  await stampDeployment(primary.admin, "preproduction");

  secondaryDatabaseUrl = roleUrl(secondary.pg.uri, "app_login", "app_pw");
  primaryDatabaseUrl = roleUrl(primary.pg.uri, "app_login", "app_pw");
}, 180_000);

afterAll(async () => {
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  if (backupDir !== undefined) await rm(backupDir, { recursive: true, force: true });
  rmSync(STATE_ROOT, { recursive: true, force: true });
});

/** An OS-assigned free port, released before use (boot.test.ts's helper — WAITRON_HTTP_PORT rejects "0"). */
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

/** Poll `predicate` up to ~10s for its first defined value (boot.test.ts's shape). */
async function poll<T>(predicate: () => T | undefined): Promise<T | undefined> {
  for (let i = 0; i < 200; i += 1) {
    const value = predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  return undefined;
}

/** `boot.ts` hardcodes `process.stdout.write` as its log sink, so capturing it is the only way to observe
 * what it logs. Every chunk is forwarded to the real writer (boot.test.ts's own helper). */
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

interface LogLine {
  event: string;
  [key: string]: unknown;
}

/** The first captured line naming `event`, waiting for it to arrive rather than assuming it already has. */
async function waitForEvent(lines: readonly string[], event: string): Promise<LogLine> {
  const found = await poll(() => {
    for (const line of lines) {
      let parsed: LogLine | undefined;
      try {
        parsed = JSON.parse(line) as LogLine;
      } catch {
        continue;
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

/** True if any captured line's `event` is EXACTLY `event`. Exact, not prefix: `backup.disabled` and
 * `backup.disabled_probe_failed` must be told apart — a non-primary logs the former (the duty is
 * skipped before the probe), a primary that runs and fails the probe logs the latter. */
function hasEvent(lines: readonly string[], event: string): boolean {
  return lines.some((line) => {
    try {
      return (JSON.parse(line) as LogLine).event === event;
    } catch {
      return false;
    }
  });
}

// The singleton duties' config, present in FULL on both boots so the ONLY thing that decides whether
// they run is `singleton_role`. The relay is unreachable (port 1) on purpose: the real call-through
// worker backs off — this suite asserts the WIRING (started or not), never a live connection. Each
// boot fills in its own DATABASE url.
function dutyEnv(port: number) {
  return {
    ...KEY_ENV,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_TUNNEL_RELAY_URL: "tcp://127.0.0.1:1",
    WAITRON_TUNNEL_BOX_ID: "box-secondary",
    WAITRON_TUNNEL_TOKEN: "tunnel-secret",
  };
}

// The backup config goes through the RAW `base` arg (2nd `startServer` param), not the merged `env`:
// the supervisor re-reads its config off `loadBoxEnv(base, stateDir)` each reload, so a value only in
// `env` would never reach it. The backup DB is unreachable (port 1) on purpose so the read-privilege
// probe fails fast on the primary — the WIRING assertion, never a live connection.
function backupBase() {
  return {
    WAITRON_BACKUP_DIR: backupDir,
    WAITRON_BACKUP_DATABASE_URL: "postgres://user:pw@127.0.0.1:1/db",
    // Required since BR-1 Task 4 (fail-closed like the db url) — without it loadBackupConfig throws
    // backup.recovery_key_missing before either boot reaches the wiring this suite asserts.
    WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!",
  };
}

describe("singleton-duty boot (real Postgres, deployment.singleton_role gating)", () => {
  it("a sell-only local secondary (primary, secondary) runs NEITHER singleton duty, though it is not a mirror", async () => {
    const port = await freePort();
    const [server, lines] = await withCapturedStdout(async (captured) => {
      const started = await startServer(
        {
          ...dutyEnv(port),
          DATABASE_URL: secondaryDatabaseUrl,
          WAITRON_MIGRATIONS_DATABASE_URL: secondary.pg.uri,
        },
        backupBase(),
      );
      // The loop's first sleep is logged strictly AFTER the (synchronous) boot has decided every gate
      // above — the backup/tunnel blocks run before `runLoop` — so once this line has arrived the backup
      // gate has been evaluated and the absence assertions below are not merely "not yet".
      await waitForEvent(captured, "loop.sleeping");
      return [started, captured] as const;
    });
    try {
      // 1. Backup — the supervisor is built and `reload()` runs on every boot, but a NON-PRIMARY takes
      // the disabled branch BEFORE the read-privilege probe: `backup.disabled` is logged and the
      // probe-failure line (only a primary that RUNS the probe emits it) is ABSENT. The primary control
      // below emits `backup.disabled_probe_failed` for the identical config, so this split is the gate
      // (duty skipped on the secondary, entered on the primary), not a missing config.
      expect(hasEvent(lines, "backup.disabled")).toBe(true);
      expect(hasEvent(lines, "backup.disabled_probe_failed")).toBe(false);

      // 2. Tunnel client — not dialed (the primary control dials it once).
      expect(runTunnelClient).not.toHaveBeenCalled();

      // The secondary still SELLS: its fiscal pass runs as the trivial empty pass (singletonPass resolves a
      // non-singleton), so /health advances rather than draining/reconciling — the sell-only posture.
      await poll(() => server.health.lastPassAt ?? undefined);
      expect(server.health.lastPassAt).not.toBeNull();
    } finally {
      await server.close();
    }
  }, 60_000);

  it("the singleton primary (primary, primary) of the same identity DOES run both (control: the secondary's absence is real)", async () => {
    const port = await freePort();
    const [server, lines] = await withCapturedStdout(async (captured) => {
      const started = await startServer(
        {
          ...dutyEnv(port),
          DATABASE_URL: primaryDatabaseUrl,
          WAITRON_MIGRATIONS_DATABASE_URL: primary.pg.uri,
        },
        backupBase(),
      );
      // The backup gate runs during the (synchronous) boot, so its `backup.*` line is emitted before the
      // first `loop.sleeping` — wait for that to be sure the gate has been decided before asserting.
      await waitForEvent(captured, "loop.sleeping");
      return [started, captured] as const;
    });
    try {
      // 1. Backup — the gate RAN: with the port-1 backup DB the read-privilege probe fails, so
      // `backup.disabled_probe_failed` is emitted. The positive twin of the secondary's absence
      // assertion — the probe is entered on the singleton primary, skipped on the secondary.
      expect(hasEvent(lines, "backup.disabled_probe_failed")).toBe(true);

      // 2. Tunnel client — dialed once.
      expect(runTunnelClient).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  }, 60_000);
});

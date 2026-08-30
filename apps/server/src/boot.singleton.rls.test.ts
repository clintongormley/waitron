import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSingletonRole, stampDeployment, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { loadKeyRing } from "@waitron/credentials";
import { enrolPeer, runRetentionSweep, runSyncPull } from "@waitron/sync";
import { runTunnelClient } from "@waitron/tunnel";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
import { roleUrl } from "./testing/postgres.js";

// The four primary-only SINGLETON duties (sync SOURCE, retention sweep, scheduled backup, outbound
// tunnel client) gate on `singleton_role`, not on `mode` (promotion #158 follow-on). This suite pins
// the topology no OTHER boot suite exercises: a SELL-ONLY LOCAL SECONDARY — `deployment.mode='primary'`
// AND `singleton_role='secondary'` — which is NOT a mirror (so `isMirror` is false and the old `!isMirror`
// gate ran all four, the active-active duplication this change fixes) yet must run NONE of the four,
// because the one singleton primary owns them. TWO manifest clones of the SAME identity: a
// `(primary, secondary)` one that runs none, and a default-`primary` one that runs all four — the control
// proving the secondary's absence is real, not a boot that silently wired nothing (CLAUDE.md §1).
//
// The `mode='mirror'` case (also runs none) is covered by `boot.mirror.rls.test.ts`; before this change a
// mirror ran none only because `!isMirror` was false, which is exactly why that suite could not catch the
// secondary bug — a secondary has `isMirror` false. `runRetentionSweep` / `runTunnelClient` are wrapped so
// the tests observe whether each duty's worker was STARTED (call-through keeps the real teardown honest);
// `runSyncPull` is wrapped call-through too because BOTH boots start the pull worker (it is NOT a singleton
// duty — it gates on sync being configured, not on the role — so a secondary still pulls; out of scope
// here, pointed at an unreachable peer so it backs off). Real Postgres, not PGlite: the boot reads
// `deployment` and runs the sync/retention pools as the non-superuser app role under FORCE RLS.

vi.mock("@waitron/sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/sync")>();
  return {
    ...actual,
    runSyncPull: vi.fn(actual.runSyncPull),
    runRetentionSweep: vi.fn(actual.runRetentionSweep),
  };
});

vi.mock("@waitron/tunnel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/tunnel")>();
  return {
    ...actual,
    runTunnelClient: vi.fn(actual.runTunnelClient),
  };
});

// One shared module mock accumulates calls across tests, so clear the spies before each so the
// call-count assertions stay order-independent (boot.test.ts's own rule). `mockClear` keeps each spy's
// `vi.fn(actual.*)` call-through implementation, resetting only `mock.calls`.
beforeEach(() => {
  vi.mocked(runSyncPull).mockClear();
  vi.mocked(runRetentionSweep).mockClear();
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

const MEDIA_ROOT = mkdtempSync(join(tmpdir(), "waitron-singleton-media-"));
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_MEDIA_DIR: MEDIA_ROOT,
  WAITRON_ENV: "preproduction",
  ...TILL_ENV,
};

// One unreachable "peer" (port 1 never listens) for WAITRON_SYNC_PEERS: every pull handshake fails and the
// worker backs off, so the box still binds and serves — the same unreachable-endpoint shape the mirror and
// sync suites use. Both boots enter the sync block (so the source-mount gate and the retention gate are
// both reached); the source and retention are what the gate skips on a secondary.
const SYNC_PEERS = JSON.stringify([
  {
    nodeId: "66666666-6666-4666-8666-666666666666",
    url: "http://127.0.0.1:1/",
    token: "peer-token",
  },
]);
// `loadKeyRing` is required by the trading branch even for a secondary; unused directly here beyond that.
loadKeyRing(KEY_ENV);

let migrationsRoot: string;
let backupDir: string;
let secondaryDatabaseUrl: string;
let secondarySyncDatabaseUrl: string;
let secondaryRetentionDatabaseUrl: string;
let primaryDatabaseUrl: string;
let primarySyncDatabaseUrl: string;
let primaryRetentionDatabaseUrl: string;
let primaryPeerToken: string;

/** Seed the FK identity (tenant, location, node, till, series) with the WAITRON_TILL_*_ID on one clone,
 * as the container superuser (RLS bypassed) — mirrors boot.mirror.rls.test.ts's `seedIdentity`. */
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
  // The control keeps the column default ('primary', 'primary') — the singleton primary that owns all four.
  await stampDeployment(primary.admin, "preproduction");

  // A peer enrolled on the primary control (enrolPeer runs as the superuser admin — setup bypasses grants);
  // the control's /sync-api/hello probe presents this token, which the source resolves against sync_peers.
  primaryPeerToken = (await enrolPeer(primary.admin, { subscriberId: "sec-ctl", name: "ctl" }))
    .token;

  secondaryDatabaseUrl = roleUrl(secondary.pg.uri, "app_login", "app_pw");
  secondarySyncDatabaseUrl = roleUrl(secondary.pg.uri, "sync_applier", "ap");
  secondaryRetentionDatabaseUrl = roleUrl(secondary.pg.uri, "sync_pruner", "pp");
  primaryDatabaseUrl = roleUrl(primary.pg.uri, "app_login", "app_pw");
  primarySyncDatabaseUrl = roleUrl(primary.pg.uri, "sync_applier", "ap");
  primaryRetentionDatabaseUrl = roleUrl(primary.pg.uri, "sync_pruner", "pp");
}, 180_000);

afterAll(async () => {
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  if (backupDir !== undefined) await rm(backupDir, { recursive: true, force: true });
  rmSync(MEDIA_ROOT, { recursive: true, force: true });
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

/** True if any captured line's `event` starts with `prefix` — used to assert a backup event's ABSENCE. */
function hasEventPrefixed(lines: readonly string[], prefix: string): boolean {
  return lines.some((line) => {
    try {
      return (JSON.parse(line) as LogLine).event.startsWith(prefix);
    } catch {
      return false;
    }
  });
}

// The four singleton duties' config, present in FULL on both boots so the ONLY thing that decides whether
// they run is `singleton_role`. The relay + backup DB are unreachable (port 1) on purpose: the real
// call-through workers back off / the backup RLS probe fails fast — this suite asserts the WIRING (started
// or not), never a live connection. Each boot fills in its own DATABASE/SYNC/RETENTION urls.
function dutyEnv(port: number) {
  return {
    ...KEY_ENV,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_SYNC_PEERS: SYNC_PEERS,
    WAITRON_TUNNEL_RELAY_URL: "tcp://127.0.0.1:1",
    WAITRON_TUNNEL_BOX_ID: "box-secondary",
    WAITRON_TUNNEL_TOKEN: "tunnel-secret",
    WAITRON_BACKUP_DIR: backupDir,
    WAITRON_BACKUP_DATABASE_URL: "postgres://user:pw@127.0.0.1:1/db",
  };
}

describe("singleton-duty boot (real Postgres, deployment.singleton_role gating)", () => {
  it("a sell-only local secondary (primary, secondary) runs NONE of the four singleton duties, though it is not a mirror", async () => {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const [server, lines] = await withCapturedStdout(async (captured) => {
      const started = await startServer({
        ...dutyEnv(port),
        DATABASE_URL: secondaryDatabaseUrl,
        WAITRON_MIGRATIONS_DATABASE_URL: secondary.pg.uri,
        WAITRON_SYNC_DATABASE_URL: secondarySyncDatabaseUrl,
        WAITRON_SYNC_RETENTION_DATABASE_URL: secondaryRetentionDatabaseUrl,
      });
      // The loop's first sleep is logged strictly AFTER the (synchronous) boot has decided every gate above
      // — the sync/retention/backup/tunnel blocks all run before `runLoop` — so once this line has arrived
      // the backup gate has been evaluated and the absence assertions below are not merely "not yet".
      await waitForEvent(captured, "loop.sleeping");
      return [started, captured] as const;
    });
    try {
      // 1. Sync SOURCE — not mounted: /sync-api/hello 404 even for a peer (the primary control below serves
      //    it 200, so this 404 is the gate, not a route that never existed).
      const source = await fetch(`${base}/sync-api/hello`);
      expect(source.status).toBe(404);

      // 2. Retention sweep — not started (the primary control starts it once).
      expect(runRetentionSweep).not.toHaveBeenCalled();

      // 3. Backup — the gate is skipped ENTIRELY, so NEITHER the RLS probe failure
      //    (backup.disabled_probe_failed) NOR the disabled-info line (backup.disabled) is logged. The
      //    primary control below emits a backup.* line for the identical env, so this absence is the gate
      //    rather than a missing config. Asserted after loop.sleeping arrived, so the gate has been decided.
      expect(hasEventPrefixed(lines, "backup.")).toBe(false);

      // 4. Tunnel client — not dialed (the primary control dials it once).
      expect(runTunnelClient).not.toHaveBeenCalled();

      // The secondary still SELLS: its fiscal pass runs as the trivial empty pass (singletonPass resolves a
      // non-singleton), so /health advances rather than draining/reconciling — the sell-only posture.
      await poll(() => server.health.lastPassAt ?? undefined);
      expect(server.health.lastPassAt).not.toBeNull();
    } finally {
      await server.close();
    }
    await expect(fetch(`${base}/sync-api/hello`)).rejects.toThrow(); // listener gone
  }, 60_000);

  it("the singleton primary (primary, primary) of the same identity DOES run all four (control: the secondary's absence is real)", async () => {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const server = await startServer({
      ...dutyEnv(port),
      DATABASE_URL: primaryDatabaseUrl,
      WAITRON_MIGRATIONS_DATABASE_URL: primary.pg.uri,
      WAITRON_SYNC_DATABASE_URL: primarySyncDatabaseUrl,
      WAITRON_SYNC_RETENTION_DATABASE_URL: primaryRetentionDatabaseUrl,
    });
    try {
      // 1. Sync SOURCE — mounted and peer-authenticated (200 with the enrolled token).
      const source = await fetch(`${base}/sync-api/hello`, {
        headers: { Authorization: `Bearer ${primaryPeerToken}` },
      });
      expect(source.status).toBe(200);

      // 2. Retention sweep — started once.
      expect(runRetentionSweep).toHaveBeenCalledTimes(1);

      // 4. Tunnel client — dialed once.
      expect(runTunnelClient).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
    await expect(fetch(`${base}/sync-api/hello`)).rejects.toThrow();
  }, 60_000);
});
